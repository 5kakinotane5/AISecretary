import type { NextRequest } from "next/server";
import { PlanCandidatesResponseSchema } from "@/lib/schemas";
import { getWeekStart, toDateStr } from "@/lib/datetime";
import { handle } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getNow } from "@/lib/server/clock";
import { listLatestCandidates } from "@/lib/server/repositories/plans";

// GET /api/plans/candidates（plans-replan.md 11.1 FR-08-12）：{ candidates }
// 最新の生成で、week_start が今週の3案（intensive・balanced・relaxed の順）。なければ空配列
export async function GET(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const weekStart = getWeekStart(toDateStr(await getNow(user.id, supabase)));
    return PlanCandidatesResponseSchema.parse({ candidates: await listLatestCandidates(supabase, weekStart) });
  });
}
