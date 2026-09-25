import { NextResponse, type NextRequest } from "next/server";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { buildDayView } from "@/lib/mock/calendar";

// GET /api/calendar/day?date=（4章）
export async function GET(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const date = request.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  return NextResponse.json(buildDayView(date));
}
