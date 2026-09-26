import { describe, expect, it } from "vitest";
import { evaluateObjectives } from "../objectives";
import { createPlanningContext } from "./fixtures";

describe("evaluateObjectives", () => {
  it("taskがない場合も有限な0〜1を返し、入力を変更しない", () => {
    const context = createPlanningContext();
    context.tasks = [];
    const before = structuredClone(context);
    const days = Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${String(5 + index).padStart(2, "0")}`, items: [] }));
    const result = evaluateObjectives(context, days, { slots: [] });
    expect(result).toMatchObject({ achievement: 1, task_fit: 1, buffer: 1, recovery: 1 });
    expect(Object.values(result).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(evaluateObjectives(context, days, { slots: [] })).toEqual(result);
    expect(context).toEqual(before);
  });
});
