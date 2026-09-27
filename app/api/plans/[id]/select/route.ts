import type { NextRequest } from "next/server";
import { SelectPlanResponseSchema } from "@/lib/schemas";
import { handle, HttpError } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getNow } from "@/lib/server/clock";
import { getPlan, selectPlan } from "@/lib/server/repositories/plans";
// POST /api/plans/{id}/select（plans-replan.md 11.1 FR-08-13）：{ active_plan_id }
// select_plan(id, getNow())。候補でない id は404。
// preference_weights の学習（P9.2、優先度B）は作らない
export async function POST(request: NextRequest, ctx: RouteContext<"/api/plans/[id]/select">) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const { id } = await ctx.params;

    const plan = await getPlan(supabase, id);
    if (!plan || plan.status !== "candidate") throw new HttpError(404, "NOT_FOUND", "選べる案が見つかりません");
    await selectPlan(supabase, plan.id, await getNow(user.id, supabase));
    return SelectPlanResponseSchema.parse({ active_plan_id: plan.id });
  });
}
