import { NextResponse, type NextRequest } from "next/server";
import { GoalSchema } from "@/lib/schemas";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { confirmGoal, getState, setInterviewState } from "@/lib/mock/store";

// POST /api/interview/confirm（4章）：{ session_id } → { state: "READY_FOR_PLANNING", goal }
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const body = await request.json().catch(() => null);
  const sessionId = body && typeof body === "object" ? (body as { session_id?: unknown }).session_id : undefined;

  const state = getState();
  if (typeof sessionId !== "string" || state.interview_session_id !== sessionId || !state.interview_goal_draft) {
    return NextResponse.json({ error: "確定できる目標がありません" }, { status: 400 });
  }

  confirmGoal(state.interview_goal_draft);
  setInterviewState("READY_FOR_PLANNING");

  return NextResponse.json({ state: "READY_FOR_PLANNING", goal: GoalSchema.parse(state.interview_goal_draft) });
}
