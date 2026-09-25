import { NextResponse, type NextRequest } from "next/server";
import { MockClockResponseSchema } from "@/lib/schemas";
import { isMockError, mockErrorResponse } from "@/lib/mock/http";
import { applyClockRequest } from "@/lib/mock/clock";
import { getState } from "@/lib/mock/store";

// GET /api/mock/clock（4章・10.20章）：今のデモ時刻 { now } を返すだけ（時刻は変えない）。
// /today はこれで時刻を読む。/replan は開いたときにこれで読み、18:00より前なら POST で18:00を明示して送る。
export async function GET(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();

  return NextResponse.json(MockClockResponseSchema.parse({ now: getState().demo_now }));
}

// POST /api/mock/clock（4章・10.6章）
// { now } が指定されればその時刻に設定する（/settings のデモ時刻切り替え、/replan の18:00への繰り上げ）。
// 指定が無ければ、demo_now が18:00より前なら18:00に進める。
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();

  const body = await request.json().catch(() => ({}));
  const now = body && typeof body === "object" && typeof (body as { now?: unknown }).now === "string" ? (body as { now: string }).now : null;

  return NextResponse.json(MockClockResponseSchema.parse(applyClockRequest(now)));
}
