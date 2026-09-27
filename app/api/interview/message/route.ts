import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeWeeklyFreeMinutes, WeeklyFreeMinutesError } from "@/lib/planning/slots";
import { buildPlanningContext } from "@/lib/server/planning-context";
import { InterviewMessageRequestSchema, InterviewTurnSchema } from "@/lib/schemas";
import { toDateStr } from "@/lib/datetime";
import { formatGoalSelectionMessage } from "@/lib/labels";
import { handle, HttpError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getNow } from "@/lib/server/clock";
import { answerByScript, FINAL_CONFIRMATION_MESSAGE } from "@/lib/server/interview-script";
import { buildGoalDraft, buildSummaryMessage } from "@/lib/server/interview-summary";
import { getInterviewSession, saveInterviewTurn, type InterviewSlots } from "@/lib/server/repositories/interview";
import { listTasks } from "@/lib/server/repositories/tasks";

// 今週の空きの合計分（7.2.2 の上限）。PlanningContext（8.3）と computeWeeklyFreeMinutes() で求める。
// 骨組みが成立せず求められないときは null（上限をかけない。7.2 に失敗時の決まりがないため）
async function loadWeeklyFreeMinutes(supabase: SupabaseClient, userId: string): Promise<number | null> {
  const context = await buildPlanningContext(supabase, userId, null);
  try {
    return computeWeeklyFreeMinutes(context);
  } catch (e) {
    if (!(e instanceof WeeklyFreeMinutesError)) throw e;
    console.warn("[interview/message] weekly free minutes unavailable:", e.name);
    return null;
  }
}

// 発言は保存したが、同時に送られた別のリクエストが先にセッションを進めていた（saveInterviewTurn が null）
function conflict() {
  return new HttpError(409, "INVALID_STATE", "ほかの操作でヒアリングが進みました。最初からやり直してください");
}

// 抽出結果を slots にマージする。null・空配列では上書きしない（backend.md 6.2.1）
function mergeSlots(slots: InterviewSlots, extracted: Partial<InterviewSlots>): InterviewSlots {
  const merged = { ...slots };
  for (const [key, value] of Object.entries(extracted) as [keyof InterviewSlots, unknown][]) {
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    Object.assign(merged, { [key]: value });
  }
  return merged;
}

// POST /api/interview/message（backend.md 6.2.1・6.2.4、mock-spec 10.1・10.15）
// ステップ1〜4 は text を受け、次のステップへ進む。ステップ4の回答ではステップ5の発言と3案（step 6）を返す。
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
      const summary = buildSummaryMessage(goalDraft, await listTasks(supabase), today);

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

    // TODO: LLM_MODE=on（lib/llm/interview.ts、6.2.3）を作ったら、LLM_MODE=on かつ OPENAI_API_KEY があるときは
    // LLM で抽出する（common.md 1.4）。今は LLM_MODE にかかわらず台本（6.2.6）で動かす
    const today = toDateStr(await getNow(user.id, supabase));
    const weeklyFreeMinutes = stepIndex === 4 ? await loadWeeklyFreeMinutes(supabase, user.id) : null;
    const answer = answerByScript(stepIndex, session.slots, today, weeklyFreeMinutes);

    const saved = await saveInterviewTurn(
      supabase,
      session,
      {
        state: "INTERVIEWING",
        step: answer.next.step,
        step_index: answer.next.step_index,
        retry_count: 0, // ステップが進んだら0に戻す（台本では聞き直さない）
        slots: mergeSlots(session.slots, answer.slots),
        goal_candidates: answer.goal_candidates,
        goal_draft: null,
      },
      [
        { role: "user", text: body.text },
        { role: "ai", text: answer.next.ai_message },
      ],
    );
    if (!saved) throw conflict();

    return InterviewTurnSchema.parse({
      session_id: session.id,
      state: "INTERVIEWING",
      step: answer.next.step,
      step_index: answer.next.step_index,
      messages: saved.filter((m) => m.role === "ai"), // 利用者の吹き出しは画面が出す（mock-spec 10.2）
      quick_replies: answer.next.quick_replies,
      goal_candidates: answer.goal_candidates,
      goal_draft: null,
    });
  });
}
