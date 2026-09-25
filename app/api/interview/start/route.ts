import { NextResponse, type NextRequest } from "next/server";
import { InterviewTurnSchema } from "@/lib/schemas";
import { nowIsoJst } from "@/lib/datetime";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { startInterviewSession } from "@/lib/mock/store";
import { INTERVIEW_QUESTIONS } from "@/mocks/interview-script";

// POST /api/interview/start（4章）：ヒアリングを開始し、ステップ1（category）を返す
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const sessionId = crypto.randomUUID();
  startInterviewSession(sessionId);

  const question = INTERVIEW_QUESTIONS.category;
  const turn = InterviewTurnSchema.parse({
    session_id: sessionId,
    state: "INTERVIEWING",
    step: question.step,
    step_index: question.stepIndex,
    messages: [{ id: crypto.randomUUID(), role: "ai", text: question.aiMessage, created_at: nowIsoJst() }],
    quick_replies: question.quickReplies,
    goal_candidates: null,
    goal_draft: null,
  });

  return NextResponse.json(turn);
}
