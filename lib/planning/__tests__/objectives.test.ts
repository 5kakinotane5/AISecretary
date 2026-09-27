import { describe, expect, it } from "vitest";
import { ScheduleItemSchema, type DayPlan } from "@/lib/schemas";
import { computePlanStats, evaluateObjectives } from "../objectives";
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

describe("computePlanStats", () => {
  it("now以降だけをP8.2と同じ定義で集計する", () => {
    const context = createPlanningContext();
    const make = (id: string, kind: "task" | "buffer" | "free", start: string, end: string, suggestedTaskId: string | null = null) => ScheduleItemSchema.parse({ id, kind, title: id, start_at: `2026-10-05T${start}:00+09:00`, end_at: `2026-10-05T${end}:00+09:00`, location_id: "loc_home", task_id: kind === "task" ? "task_report" : null, fixed_event_id: null, fixed_category: null, travel: null, suggested_task_id: suggestedTaskId, locked: false, status: "planned", reason: null });
    const days: DayPlan[] = [{ date: "2026-10-05", items: [
      make("crossing", "task", "06:30", "07:30"),
      make("buffer", "buffer", "07:30", "07:45", "task_email"),
      make("free", "free", "07:45", "08:45"),
      make("past", "task", "06:00", "06:30"),
    ] }];
    const beforeContext = structuredClone(context);
    const beforeDays = structuredClone(days);
    const result = computePlanStats(context, days);
    expect(result).toEqual({ workMinutes: 30, bufferMinutes: 15, freeMinutes: 60, taskCount: 1 });
    expect(Object.values(result).every(Number.isFinite)).toBe(true);
    expect(computePlanStats(context, days)).toEqual(result);
    expect(context).toEqual(beforeContext);
    expect(days).toEqual(beforeDays);
  });
});
