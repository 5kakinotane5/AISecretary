import { NextResponse, type NextRequest } from "next/server";
import type { PlanStyle } from "@/lib/schemas";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { setActivePlanStyle } from "@/lib/mock/store";

const STYLE_BY_PLAN_ID: Record<string, PlanStyle> = {
  plan_intensive: "intensive",
  plan_balanced: "balanced",
  plan_relaxed: "relaxed",
};

// POST /api/plans/{id}/select（4章）：{ active_plan_id }
export async function POST(request: NextRequest, ctx: RouteContext<"/api/plans/[id]/select">) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const { id } = await ctx.params;
  const style = STYLE_BY_PLAN_ID[id];
  if (!style) {
    return NextResponse.json({ error: `不明なプランIDです: ${id}` }, { status: 400 });
  }

  setActivePlanStyle(style);
  return NextResponse.json({ active_plan_id: id });
}
