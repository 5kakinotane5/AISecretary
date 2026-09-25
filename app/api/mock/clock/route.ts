import { NextResponse, type NextRequest } from "next/server";
import { isMockError, mockErrorResponse } from "@/lib/mock/http";
import { applyClockRequest } from "@/lib/mock/clock";

// POST /api/mock/clock（4章・10.6章）
// { now } が指定されればその時刻に設定する（/settings のデモ時刻切り替え用）。
// 指定が無ければ、demo_now が18:00より前なら18:00に進める（/replan を開いたときの自動繰り上げ用）。
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();

  const body = await request.json().catch(() => ({}));
  const now = body && typeof body === "object" && typeof (body as { now?: unknown }).now === "string" ? (body as { now: string }).now : null;

  return NextResponse.json(applyClockRequest(now));
}
