import { NextResponse, type NextRequest } from "next/server";
import { getWeekStart } from "@/lib/datetime";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { buildWeekView } from "@/lib/mock/calendar";

// GET /api/calendar/week?start=（4章）
export async function GET(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const start = request.nextUrl.searchParams.get("start");
  if (!start) {
    return NextResponse.json({ error: "start is required" }, { status: 400 });
  }

  return NextResponse.json(buildWeekView(getWeekStart(start)));
}
