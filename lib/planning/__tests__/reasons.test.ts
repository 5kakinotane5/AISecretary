import { describe, expect, it } from "vitest";
import { ScheduleItemSchema, type DayPlan } from "@/lib/schemas";
import { computeTaskPriorities } from "../priority";
import { addBufferSuggestions, applyGenerationReasons, buildExplanation, timeBandLabel } from "../reasons";
import { createPlanningContext } from "./fixtures";

const item = (overrides: Record<string, unknown> = {}) => ScheduleItemSchema.parse({ id: "x", kind: "free", title: "自由時間", start_at: "2026-10-05T08:00:00+09:00", end_at: "2026-10-05T09:00:00+09:00", location_id: "loc_home", task_id: null, fixed_event_id: null, fixed_category: null, travel: null, suggested_task_id: null, locked: false, status: "planned", reason: null, ...overrides });

describe("reasons", () => {
  it.each([["09:59", "朝"], ["10:00", "午前"], ["12:00", "午後"], ["17:00", "夕方"], ["19:00", "夜"]])("%sは%s", (time, label) => expect(timeBandLabel(`2026-10-05T${time}:00+09:00`)).toBe(label));

  it("taskへ生成理由を付け、非taskはnullにする", () => {
    const context = createPlanningContext();
    const days: DayPlan[] = [{ date: "2026-10-05", items: [item({ id: "task", kind: "task", title: "レポート", task_id: "task_report" }), item({ id: "free" })] }];
    const result = applyGenerationReasons(context, days, "intensive");
    expect(result[0].items[0]).toMatchObject({ reason_code: "DEADLINE_EARLY" });
    expect(result[0].items[0].reason).toContain("締切");
    expect(result[0].items[1]).toMatchObject({ reason_code: null, reason: null });
    expect(buildExplanation(context, days, "intensive")).toContain("早め");
  });

  it("bufferへ軽作業候補を最大1件付ける", () => {
    const context = createPlanningContext();
    const days: DayPlan[] = [{ date: "2026-10-05", items: [item({ kind: "buffer", title: "バッファ", end_at: "2026-10-05T08:30:00+09:00" })] }];
    const suggested = addBufferSuggestions(context, days, computeTaskPriorities(context, "2026-10-05"));
    const reasoned = applyGenerationReasons(context, suggested, "balanced");
    expect(reasoned[0].items[0].suggested_task_id).not.toBeNull();
    expect(reasoned[0].items[0]).toMatchObject({ reason_code: "LIGHT_IN_BUFFER" });
  });
});
