import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getMonthView, requireValidMonth } from "@/lib/server/calendar";

// GET /api/calendar/month?month=YYYY-MM（plans-replan.md 11.3）：MonthView（その月の全日）
export async function GET(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const month = requireValidMonth(request.nextUrl.searchParams.get("month"));
    return getMonthView(supabase, user.id, month);
  });
}
