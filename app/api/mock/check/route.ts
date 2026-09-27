import type { NextRequest } from "next/server";
import { MockCheckResultSchema, type EnginePlan, type ValidationIssue } from "@/lib/schemas";
import { getWeekStart, toDateStr } from "@/lib/datetime";
import { validateCandidateDiversity, validatePlan } from "@/lib/planning/validate";
import { handle } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { requireDemoMode } from "@/lib/server/clock";
import { buildPlanningContext } from "@/lib/server/planning-context";
import {
  getActivePlan,
  listLatestCandidates,
  listPlanFeatures,
  listPlanItems,
} from "@/lib/server/repositories/plans";

// 1案の検査結果に、どの計画のものかを書く（validatePlan は plan_id を null で返す）
function tagPlan(issues: ValidationIssue[], planId: string): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, plan_id: issue.plan_id ?? planId }));
}

// GET /api/mock/check（common.md 1.3）：デモモードのみ。
// 有効な計画（7日分）と最新の3案に Validator（planning.md 10.11、mode = "stored"）をかけた結果。
// 有効な計画が最新の3案の中にあるとき（選んだ直後など）は、同じ計画を2回検査しない。
// 計画も3案もなければ errors・warnings とも空
export async function GET(request: NextRequest) {
  return handle(request, async () => {
    requireDemoMode();
    const { user, supabase } = await requireUser();

    const active = await getActivePlan(supabase);
    const context = await buildPlanningContext(supabase, user.id, active?.style ?? null);
    const candidates = await listLatestCandidates(supabase, getWeekStart(toDateStr(context.now)));

    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // 1案ずつの検査：最新の3案 ＋（3案に入っていなければ）有効な計画
    const targets = candidates.map((c) => ({ id: c.id, days: c.days }));
    if (active && !targets.some((t) => t.id === active.id)) {
      const entries = (await listPlanItems(supabase, [active.id])).get(active.id) ?? [];
      const dates = Array.from(new Set(entries.map((e) => e.date))).sort();
      targets.push({
        id: active.id,
        days: dates.map((date) => ({
          date,
          items: entries.filter((e) => e.date === date).map((e) => e.item),
        })),
      });
    }
    for (const target of targets) {
      const result = validatePlan(context, target.days, "stored");
      errors.push(...tagPlan(result.errors, target.id));
      warnings.push(...tagPlan(result.warnings, target.id));
    }

    // 3案をまとめた検査（違いが小さすぎないか。warning だけ）
    if (candidates.length === 3) {
      const features = await listPlanFeatures(
        supabase,
        candidates.map((c) => c.id),
      );
      const plans: EnginePlan[] = [];
      for (const c of candidates) {
        const f = features.get(c.id);
        if (!f) continue;
        plans.push({
          style: c.style,
          label: c.label,
          week_start: c.week_start,
          summary: c.summary,
          features: f,
          days: c.days.map((day) => ({
            date: day.date,
            items: day.items.map((item) => ({ ...item, reason_code: null })),
          })),
        });
      }
      if (plans.length === 3)
        warnings.push(...validateCandidateDiversity(context, plans, "stored").warnings);
    }

    return MockCheckResultSchema.parse({ errors, warnings });
  });
}
