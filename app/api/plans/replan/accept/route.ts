import { NextResponse, type NextRequest } from "next/server";
import { ReplanAcceptRequestSchema } from "@/lib/schemas";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { setReplanAccepted } from "@/lib/mock/store";
import { buildDayView } from "@/lib/mock/calendar";
import { REPLAN_TIRED } from "@/mocks/replan-tired";

// POST /api/plans/replan/accept（4章）：{ proposal_id } → DayView（buildDayView の中で DayViewSchema.parse 済み）
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const parsed = ReplanAcceptRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.proposal_id !== REPLAN_TIRED.proposal_id) {
    return NextResponse.json({ error: "proposal_id が無効です" }, { status: 400 });
  }

  setReplanAccepted(true);
  return NextResponse.json(buildDayView(REPLAN_TIRED.date));
}
