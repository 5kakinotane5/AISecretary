import { describe, expect, it } from "vitest";
import { ScheduleItemSchema } from "@/lib/schemas";
import { ReplanDiffBuilder } from "../diff";

const item = (id: string, start: string) => ScheduleItemSchema.parse({ id, kind: "free", title: id, start_at: `2026-10-05T${start}:00+09:00`, end_at: `2026-10-05T23:00:00+09:00`, location_id: "loc_home", task_id: null, fixed_event_id: null, fixed_category: null, travel: null, suggested_task_id: null, locked: false, status: "planned", reason: null });

describe("ReplanDiffBuilder", () => {
  it("操作時の全change typeを重複なく安定順で記録する", () => {
    const builder = new ReplanDiffBuilder();
    const late = item("late", "20:00"); const early = item("early", "18:00");
    for (const change_type of ["moved", "shortened", "replaced", "removed", "added"] as const) builder.record("today", { change_type, before: change_type === "added" ? null : late, after: change_type === "removed" ? [] : [early], moved_to_date: change_type === "moved" ? "2026-10-06" : null, reason: change_type });
    builder.record("today", { change_type: "removed", before: late, reason: "removed" });
    builder.record("other", { change_type: "moved", before: late, after: [early], moved_to_date: "2026-10-07", reason: "later" });
    builder.record("other", { change_type: "moved", before: early, after: [early], moved_to_date: "2026-10-06", reason: "earlier" });
    const result = builder.build();
    expect(result.changes).toHaveLength(5);
    expect(result.changes.map((change) => change.change_type).sort()).toEqual(["added", "moved", "removed", "replaced", "shortened"]);
    expect(result.other_day_changes.map((change) => change.moved_to_date)).toEqual(["2026-10-06", "2026-10-07"]);
    expect(builder.build()).toEqual(result);
  });
});
