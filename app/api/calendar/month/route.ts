import { NextResponse, type NextRequest } from "next/server";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { buildMonthView } from "@/lib/mock/calendar";

// GET /api/calendar/month?month=（4章）
export async function GET(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const month = request.nextUrl.searchParams.get("month");
  if (!month) {
    return NextResponse.json({ error: "month is required" }, { status: 400 });
  }

  return NextResponse.json(buildMonthView(month));
}
