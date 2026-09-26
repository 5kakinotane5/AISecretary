import { describe, expect, it } from "vitest";
import type { WeekBuildResult } from "../day-beam";
import { buildSkeleton } from "../skeleton";
import { buildFreeSlots } from "../slots";
import { detectCapacityShortage, explainFailures } from "../recover";
import { createPlanningContext } from "./fixtures";

describe("explainFailures", () => {
  it("最小の必須残量から締切不足を決定論的に説明する", () => {
    const context = createPlanningContext();
    const failure: WeekBuildResult = { ok: false, direction: "balanced", allocation: { rho: 0.45, kappa: 0, goal_order: "early" }, reason: "carry", date: "2026-10-08", remaining: [{ quota_key: "q", quota: { kind: "deadline", task_id: "task_report", minutes: 60, required: true, band: null, carryover: "deadline_before_due", deadline_at: context.tasks.find((task) => task.id === "task_report")!.deadline_at, completion_target_date: "2026-10-07" }, initial_minutes: 60, remaining_minutes: 45 }] };
    const result = explainFailures(context, [failure]);
    expect(result.reason).toContain("45分足りません");
    expect(result.required_changes.length).toBeLessThanOrEqual(3);
    expect(explainFailures(context, [failure])).toEqual(result);
  });

  it("締切不足と目標不足を正の分数で返す", () => {
    const deadline = createPlanningContext();
    const built = buildSkeleton(deadline);
    if (!built.ok) throw new Error("fixture skeleton");
    const slots = buildFreeSlots(deadline, built.days);
    deadline.tasks.find((task) => task.id === "task_report")!.remaining_minutes = 20_000;
    expect(detectCapacityShortage(deadline, slots)?.reason).toMatch(/空き時間が\d+分足りません/);
    const goal = createPlanningContext();
    goal.goal_week_target_minutes.goal_toeic = 20_000;
    expect(detectCapacityShortage(goal, slots)?.reason).toContain("TOEIC学習");
  });
});
