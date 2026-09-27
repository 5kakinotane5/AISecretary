import type { NextRequest } from "next/server";
import { handle, requireValidDate } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getWeekView } from "@/lib/server/calendar";

// GET /api/calendar/week?start=（plans-replan.md 11.3）：start を含む週の月曜から7日分の WeekView
export async function GET(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const start = requireValidDate(request.nextUrl.searchParams.get("start"));
    return getWeekView(supabase, user.id, start);
  });
}
