import { NextResponse, type NextRequest } from "next/server";
import { InterviewMessageRequestSchema, InterviewTurnSchema, type InterviewMessage } from "@/lib/schemas";
import { nowIsoJst } from "@/lib/datetime";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { getState, setInterviewGoalDraft, setInterviewState, setInterviewStepIndex } from "@/lib/mock/store";
import { INTERVIEW_QUESTIONS, buildSummaryMessage, FINAL_CONFIRMATION_MESSAGE } from "@/mocks/interview-script";
import { GOAL_TIME_CANDIDATES } from "@/mocks/goal-candidates";
import { GOAL } from "@/mocks/goal";

function aiMessage(text: string): InterviewMessage {
  return { id: crypto.randomUUID(), role: "ai", text, created_at: nowIsoJst() };
}

// POST /api/interview/message（4章・10.1〜10.3章）
// text と selection はどちらか一方だけ（InterviewMessageRequestSchema の refine で検証済み）。
// 台本は固定なので、入力内容にかかわらず現在のステップから次のステップへ進める。
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(800);

  const body = await request.json().catch(() => null);
  const parsed = InterviewMessageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { session_id, text, selection } = parsed.data;

  const state = getState();
  if (state.interview_session_id !== session_id) {
    return NextResponse.json({ error: "session_id が無効です" }, { status: 400 });
  }

  // ステップ1〜4：自由入力・クイックリプライへの回答（10.3章：内容に関わらず台本どおり次に進む）
  if (state.interview_step_index >= 1 && state.interview_step_index <= 4) {
    if (text === undefined) {
      return NextResponse.json({ error: "このステップでは text を送ってください" }, { status: 400 });
    }
    const nextIndex = state.interview_step_index + 1;
    if (nextIndex <= 4) {
      const key = (["category", "goal", "current_status", "conditions"] as const)[nextIndex - 1];
      const question = INTERVIEW_QUESTIONS[key];
      setInterviewStepIndex(nextIndex);
      return NextResponse.json(
        InterviewTurnSchema.parse({
          session_id,
          state: "INTERVIEWING",
          step: question.step,
          step_index: question.stepIndex,
          messages: [aiMessage(question.aiMessage)],
          quick_replies: question.quickReplies,
          goal_candidates: null,
          goal_draft: null,
        }),
      );
    }

    // ステップ4（conditions）の回答 → ステップ5・6を1回の応答にまとめる（10.1章）
    setInterviewStepIndex(6);
    return NextResponse.json(
      InterviewTurnSchema.parse({
        session_id,
        state: "INTERVIEWING",
        step: "goal_candidates",
        step_index: 6,
        messages: [aiMessage(INTERVIEW_QUESTIONS.time_estimation.aiMessage)],
        quick_replies: [],
        goal_candidates: GOAL_TIME_CANDIDATES,
        goal_draft: null,
      }),
    );
  }

  // ステップ6〜7：3案のカードから選択 → ステップ8・9を1回の応答にまとめる（10.1・10.3章）
  if (state.interview_step_index === 6) {
    if (!selection) {
      return NextResponse.json({ error: "このステップでは selection を送ってください" }, { status: 400 });
    }
    const goalDraft = {
      ...GOAL,
      target_hours_per_week: selection.hours_per_week,
      user_selected_plan: selection.style,
    };
    setInterviewGoalDraft(goalDraft);
    setInterviewStepIndex(9);
    setInterviewState("CONFIRMING");
    return NextResponse.json(
      InterviewTurnSchema.parse({
        session_id,
        state: "CONFIRMING",
        step: "final_confirmation",
        step_index: 9,
        messages: [aiMessage(buildSummaryMessage(selection.hours_per_week)), aiMessage(FINAL_CONFIRMATION_MESSAGE)],
        quick_replies: [],
        goal_candidates: null,
        goal_draft: goalDraft,
      }),
    );
  }

  // ステップ9（最終確認）は「確定する」ボタン（POST /api/interview/confirm）で進める
  return NextResponse.json({ error: "現在のステップでは message を受け付けていません" }, { status: 400 });
}
