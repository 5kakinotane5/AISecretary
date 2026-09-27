import type { NextRequest } from "next/server";
import { handle, requireValidDate } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getDayView } from "@/lib/server/calendar";

// GET /api/calendar/day?date=（plans-replan.md 11.3）：DayView
export async function GET(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const date = requireValidDate(request.nextUrl.searchParams.get("date"));
    return getDayView(supabase, user.id, date);
  });
}
