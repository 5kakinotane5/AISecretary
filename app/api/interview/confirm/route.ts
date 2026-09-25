import { NextResponse, type NextRequest } from "next/server";
import { InterviewConfirmRequestSchema, InterviewConfirmResponseSchema } from "@/lib/schemas";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { confirmGoal, getState, setInterviewState } from "@/lib/mock/store";

// POST /api/interview/confirm（4章）：{ session_id } → { state: "READY_FOR_PLANNING", goal }
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const parsed = InterviewConfirmRequestSchema.safeParse(await request.json().catch(() => null));
  const state = getState();
  if (!parsed.success || state.interview_session_id !== parsed.data.session_id || !state.interview_goal_draft) {
    return NextResponse.json({ error: "確定できる目標がありません" }, { status: 400 });
  }

  confirmGoal(state.interview_goal_draft);
  setInterviewState("READY_FOR_PLANNING");

  return NextResponse.json(
    InterviewConfirmResponseSchema.parse({ state: "READY_FOR_PLANNING", goal: state.interview_goal_draft }),
  );
}
