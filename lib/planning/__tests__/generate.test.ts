import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { generatePlans, planDistances } from "../generate";
import { validatePlan } from "../validate";
import { createPlanningContext } from "./fixtures";

describe("generatePlans（planning.md P11）", () => {
  it("fixtureから検証済みの3案を決定論的に生成する", () => {
    const context = createPlanningContext();
    const before = structuredClone(context);
    const started = performance.now();
    const result = generatePlans(context);
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plans.map((plan) => plan.style)).toEqual(["intensive", "balanced", "relaxed"]);
    for (const plan of result.plans) {
      expect(validatePlan(context, plan.days, "generate").errors).toEqual([]);
      expect(plan.summary.goal_hours).toBe(6);
      expect(plan.days[0].items.some((item) => item.task_id === "task_toeic_listening" && item.start_at >= "2026-10-05T18:00:00+09:00")).toBe(true);
      expect(plan.days.flatMap((day) => day.items).some((item) => (item.kind === "task" || item.kind === "buffer") && item.start_at.slice(11, 16) >= "23:30")).toBe(false);
      for (const item of plan.days.flatMap((day) => day.items)) {
        if (!item.locked) expect(item.id).toMatch(new RegExp(`^tmp_${plan.style}_\\d{4}-\\d{2}-\\d{2}_\\d{3}$`));
        if (["fixed", "sleep", "travel", "free"].includes(item.kind)) expect(item).toMatchObject({ reason_code: null, reason: null });
        if (item.kind === "task") expect(item.reason_code).not.toBeNull();
      }
    }
    expect(result.plans[0].features.achievement).toBeGreaterThanOrEqual(result.plans[2].features.achievement);
    expect(result.plans[2].features.free_time).toBeGreaterThanOrEqual(result.plans[0].features.free_time);
    expect(result.plans[2].features.recovery).toBeGreaterThanOrEqual(result.plans[0].features.recovery);
    expect(planDistances(result.plans, context.now).every((distance) => distance >= CONFIG.diversity.minDistance)).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(elapsed).toBeLessThan(10_000);
    expect(JSON.stringify(generatePlans(context))).toBe(JSON.stringify(result));
    expect(context).toEqual(before);
  }, 30_000);

  it("骨組み不成立をそのまま返す", () => {
    const context = createPlanningContext();
    context.travel_times = [];
    expect(generatePlans(context)).toMatchObject({ ok: false, infeasible: { feasible: false } });
  });

  it.each(["deadline", "goal"])("置けない%s必須量はrequired_changes付きinfeasibleにする", (kind) => {
    const context = createPlanningContext();
    if (kind === "deadline") context.tasks.find((task) => task.id === "task_report")!.remaining_minutes = 20_000;
    else context.goal_week_target_minutes.goal_toeic = 20_000;
    const result = generatePlans(context);
    expect(result).toMatchObject({ ok: false, infeasible: { feasible: false } });
    if (!result.ok) expect(result.infeasible.required_changes.length).toBeGreaterThan(0);
  });

  it("fatigue=highの今日は締切最終日以外の高集中タスクを置かない", () => {
    const context = createPlanningContext();
    context.checkin = { date: "2026-10-05", mood: null, fatigue: "high", concentration: null, want_task_ids: [], avoid_task_ids: [], note: null };
    const result = generatePlans(context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const highIds = new Set(context.tasks.filter((task) => task.concentration === "high" || (task.goal_id && task.concentration === "medium")).map((task) => task.id));
    for (const plan of result.plans) {
      expect(plan.days[0].items.some((item) => item.kind === "task" && item.task_id && highIds.has(item.task_id))).toBe(false);
    }
  }, 30_000);

});
