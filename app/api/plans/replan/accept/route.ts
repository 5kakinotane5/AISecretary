import { NextResponse, type NextRequest } from "next/server";
import { DayViewSchema, ReplanAcceptRequestSchema } from "@/lib/schemas";
import { toDateStr } from "@/lib/datetime";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { REPLAN_TIRED } from "@/mocks/replan-tired";
import { TASKS } from "@/mocks/tasks";

// POST /api/plans/replan/accept（4章）：{ proposal_id } → DayView
// まだモック：モックの再計画後の10/5をそのまま返すだけで、DB の計画は変えない
// （calendar は本番化済みなので、/today・/calendar には反映されない）
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const parsed = ReplanAcceptRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.proposal_id !== REPLAN_TIRED.proposal_id) {
    return NextResponse.json({ error: "proposal_id が無効です" }, { status: 400 });
  }

  const { date, items } = REPLAN_TIRED.after;
  const deadlines = TASKS.filter((t) => t.deadline_at !== null && toDateStr(t.deadline_at) === date).map((t) => ({
    task_id: t.id,
    title: t.title,
  }));
  return NextResponse.json(DayViewSchema.parse({ date, has_plan: true, items, deadlines }));
}
