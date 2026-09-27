import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeWeeklyFreeMinutes, WeeklyFreeMinutesError } from "@/lib/planning/slots";
import { buildPlanningContext } from "@/lib/server/planning-context";
import { InterviewMessageRequestSchema, InterviewTurnSchema, type GoalTimeCandidate } from "@/lib/schemas";
import { toDateStr } from "@/lib/datetime";
import { formatGoalSelectionMessage } from "@/lib/labels";
import { handle, HttpError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getNow } from "@/lib/server/clock";
import { isLlmEnabled, LlmError } from "@/lib/llm/client";
import { buildGoalCandidates } from "@/lib/server/goal-candidates";
import { answerByLlm, type InterviewAnswer } from "@/lib/server/interview-llm";
import { answerByScript, FINAL_CONFIRMATION_MESSAGE } from "@/lib/server/interview-script";
import { buildGoalDraft, buildSummaryMessage } from "@/lib/server/interview-summary";
import {
  getInterviewSession,
  listRecentMessages,
  mergeSlots,
  saveInterviewTurn,
  type InterviewSession,
  type InterviewSlots,
} from "@/lib/server/repositories/interview";
import { listTasks } from "@/lib/server/repositories/tasks";

// 目標時間3案（7.2）。PlanningContext（8.3）を1回だけ組み立て、今週の空きの合計分（7.2.2 の上限）と
// 固定予定（7.2.3 の一言）の両方に使う。空きは骨組みが成立せず求められないときは null（上限をかけない。7.2 に失敗時の決まりがないため）
async function loadGoalCandidates(
  supabase: SupabaseClient,
  userId: string,
  slots: InterviewSlots,
  today: string,
): Promise<GoalTimeCandidate[]> {
  const context = await buildPlanningContext(supabase, userId, null);
  let weeklyFreeMinutes: number | null = null;
  try {
    weeklyFreeMinutes = computeWeeklyFreeMinutes(context);
  } catch (e) {
    if (!(e instanceof WeeklyFreeMinutesError)) throw e;
    console.warn("[interview/message] weekly free minutes unavailable:", e.name);
  }
  return buildGoalCandidates({ slots, today, weeklyFreeMinutes, fixedEvents: context.fixed_events });
}

// 発言は保存したが、同時に送られた別のリクエストが先にセッションを進めていた（saveInterviewTurn が null）
function conflict() {
  return new HttpError(409, "INVALID_STATE", "ほかの操作でヒアリングが進みました。最初からやり直してください");
}

// LLM に渡す直近の発言の数（6.2.3）
const RECENT_MESSAGES = 6;

// LLM_MODE=off の台本（6.2.6）の応答を、LLM と同じ形にする。台本は聞き直さない
async function answerWithScript(
  session: InterviewSession,
  stepIndex: 1 | 2 | 3 | 4,
  loadCandidates: (slots: InterviewSlots) => Promise<GoalTimeCandidate[]>,
): Promise<InterviewAnswer> {
  const answer = answerByScript(stepIndex);
  const slots = mergeSlots(session.slots, answer.slots);
  return {
    slots,
    step: answer.next.step,
    step_index: answer.next.step_index,
    retry_count: 0, // ステップが進んだら0に戻す
    ai_message: answer.next.ai_message,
    quick_replies: answer.next.quick_replies,
    // ステップ4の回答のときだけ3案を作る（文章は LLM_MODE=off なのでテンプレート。7.2.3）
    goal_candidates: stepIndex === 4 ? await loadCandidates(slots) : null,
  };
}

// POST /api/interview/message（backend.md 6.2.1・6.2.4、mock-spec 10.1・10.15）
// ステップ1〜4 は text を受け、次のステップへ進む（LLM_MODE=on ではステップ1・2で聞き直すことがある）。ステップ4の回答ではステップ5の発言と3案（step 6）を返す。
// ステップ6 は selection を受け、要約と最終確認（step 9、CONFIRMING）を返す
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const body = await parseBody(request, InterviewMessageRequestSchema);

    const session = await getInterviewSession(supabase, body.session_id);
    if (!session) throw new HttpError(404, "NOT_FOUND", "ヒアリングが見つかりません。最初からやり直してください");

    // 最終確認（ステップ9）は「確定する」ボタンを待つので、message は受け付けない（mock-spec 10.15）
    if (session.state === "CONFIRMING") {
      throw new HttpError(400, "INVALID_REQUEST", "確定ボタンを押してください");
    }
    if (session.state !== "INTERVIEWING") {
      throw new HttpError(409, "INVALID_STATE", "このヒアリングは終了しています。最初からやり直してください");
    }

    // ステップ6（3案の選択）→ ステップ8の要約とステップ9の確認を1回の応答で返す（FR-02-6、mock-spec 10.1）。
    // selection は LLM に通さず、そのまま目標案に反映する（FR-03-5）
    if (session.step_index === 6) {
      if (body.selection === undefined) {
        throw new HttpError(400, "INVALID_REQUEST", "上の案から選んでください");
      }
      const goalDraft = buildGoalDraft(session.slots, body.selection);
      const today = toDateStr(await getNow(user.id, supabase));
      // task_name を仮置きしたとき（ステップ2の聞き直しの上限）は、要約の末尾にやり直し方を付ける（6.2.2）
      const summary = buildSummaryMessage(goalDraft, await listTasks(supabase), today, {
        provisional: session.slots.task_name === null,
      });

      const saved = await saveInterviewTurn(
        supabase,
        session,
        {
          state: "CONFIRMING",
          step: "final_confirmation",
          step_index: 9,
          retry_count: 0,
          slots: session.slots,
          goal_candidates: session.goal_candidates,
          goal_draft: goalDraft,
        },
        [
          { role: "user", text: formatGoalSelectionMessage(body.selection.style, body.selection.hours_per_week) },
          { role: "ai", text: summary },
          { role: "ai", text: FINAL_CONFIRMATION_MESSAGE },
        ],
      );
      if (!saved) throw conflict();

      return InterviewTurnSchema.parse({
        session_id: session.id,
        state: "CONFIRMING",
        step: "final_confirmation",
        step_index: 9,
        messages: saved.filter((m) => m.role === "ai"),
        quick_replies: [],
        goal_candidates: null,
        goal_draft: goalDraft,
      });
    }

    const stepIndex = session.step_index;
    if (stepIndex !== 1 && stepIndex !== 2 && stepIndex !== 3 && stepIndex !== 4) {
      throw new HttpError(409, "INVALID_STATE", "このヒアリングは続けられません。最初からやり直してください");
    }
    if (body.text === undefined) {
      throw new HttpError(400, "INVALID_REQUEST", "このステップでは文章で答えてください");
    }

    // LLM_MODE=on は LLM で抽出（6.2.3）、off は台本（6.2.6）。common.md 1.4。
    // LLM は保存より前に呼ぶ。失敗したら 502 で、状態も発言も保存しない（FR-02-11）
    const today = toDateStr(await getNow(user.id, supabase));
    const loadCandidates = (slots: InterviewSlots) => loadGoalCandidates(supabase, user.id, slots, today);
    let answer: InterviewAnswer;
    if (isLlmEnabled()) {
      try {
        answer = await answerByLlm({
          session,
          stepIndex,
          text: body.text,
          recentMessages: await listRecentMessages(supabase, session.id, RECENT_MESSAGES),
          today,
          loadGoalCandidates: loadCandidates,
        });
      } catch (e) {
        if (!(e instanceof LlmError)) throw e;
        throw new HttpError(502, "LLM_ERROR", "AIの応答を受け取れませんでした。もう一度送ってください");
      }
    } else {
      answer = await answerWithScript(session, stepIndex, loadCandidates);
    }

    const saved = await saveInterviewTurn(
      supabase,
      session,
      {
        state: "INTERVIEWING",
        step: answer.step,
        step_index: answer.step_index,
        retry_count: answer.retry_count, // 進んだら0、聞き直しなら +1（step・step_index は今のまま）
        slots: answer.slots,
        goal_candidates: answer.goal_candidates,
        goal_draft: null,
      },
      [
        { role: "user", text: body.text },
        { role: "ai", text: answer.ai_message },
      ],
    );
    if (!saved) throw conflict();

    return InterviewTurnSchema.parse({
      session_id: session.id,
      state: "INTERVIEWING",
      step: answer.step,
      step_index: answer.step_index,
      messages: saved.filter((m) => m.role === "ai"), // 利用者の吹き出しは画面が出す（mock-spec 10.2）
      quick_replies: answer.quick_replies,
      goal_candidates: answer.goal_candidates,
      goal_draft: null,
    });
  });
}
