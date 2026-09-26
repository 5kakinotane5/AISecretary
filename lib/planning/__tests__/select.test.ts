import { describe, expect, it } from "vitest";
import type { ObjectiveVector } from "@/lib/schemas";
import { adjustedBeamWeights, adjustedDirections, directionDistance, dominates, featureDistance, integratedDistance, paretoFilter, selectThree, structuralDistance, type SelectablePlan } from "../select";
import { createPlanningContext } from "./fixtures";

const vector = (value: number): ObjectiveVector => ({ achievement: value, deadline_safety: value, task_fit: value, buffer: value, free_time: value, control: value, recovery: value });
const plan = (key: string, features: ObjectiveVector): SelectablePlan => ({ key, features, days: [{ date: "2026-10-05", items: [] }] });

describe("select", () => {
  it("epsilon境界を守ってPareto支配と同一Fの重複排除を行う", () => {
    expect(dominates(vector(1), vector(0.5))).toBe(true);
    expect(dominates(vector(1), vector(1 - 5e-10))).toBe(false);
    expect(paretoFilter([plan("z", vector(0.5)), plan("a", vector(1)), plan("b", vector(1))]).map((entry) => entry.key)).toEqual(["a"]);
  });

  it("距離式と状態調整が有限で決定論的", () => {
    const a = plan("a", vector(0));
    const b = plan("b", vector(1));
    expect(directionDistance(a.features, b.features)).toBeCloseTo(Math.sqrt(7));
    expect(featureDistance(a, b)).toBeCloseTo(Math.sqrt(7));
    expect(structuralDistance(a, b, "2026-10-05T07:00:00+09:00")).toBe(0);
    expect(integratedDistance(a, b, "2026-10-05T07:00:00+09:00")).toBeCloseTo(Math.sqrt(7) / 2);
    const context = createPlanningContext();
    context.checkin = { date: "2026-10-05", mood: null, fatigue: "high", concentration: "low", want_task_ids: [], avoid_task_ids: [], note: null };
    expect(adjustedDirections(context).intensive.recovery).toBeGreaterThan(0.2);
    expect(adjustedBeamWeights(context, "intensive", "2026-10-05").every(Number.isFinite)).toBe(true);
  });

  it("3方向へ異なる候補を選び、入力順に依存しない", () => {
    const context = createPlanningContext();
    const directions = adjustedDirections(context);
    const candidates = [plan("i", directions.intensive), plan("b", directions.balanced), plan("r", directions.relaxed), plan("m", vector(0.7))];
    const first = selectThree(candidates, directions, context.now);
    const second = selectThree([...candidates].reverse(), directions, context.now);
    expect(first.plans.map((entry) => entry.key)).toEqual(["i", "b", "r"]);
    expect(second.plans.map((entry) => entry.key)).toEqual(first.plans.map((entry) => entry.key));
    expect(selectThree(candidates, directions, context.now, 99).tooSimilar).toBe(true);
    expect(selectThree(candidates.slice(0, 2), directions, context.now).tooSimilar).toBe(true);
  });
});
