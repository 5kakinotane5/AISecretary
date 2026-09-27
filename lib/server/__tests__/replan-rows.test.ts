import { describe, expect, it } from "vitest";
import type { EngineReplanResult, PlannedItem, ReasonCode, ScheduleItem } from "@/lib/schemas";
import type { PlanItemRow } from "@/lib/server/repositories/plans";
import { buildReplanRows } from "@/lib/server/replan-rows";

const TODAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const USER_ID = "user-1";
const PLAN_ID = "plan-1";

const at = (date: string, time: string) => `${date}T${time}:00+09:00`;

function item(id: string, date: string, start: string, end: string, patch: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    kind: "task",
    title: id,
    start_at: at(date, start),
    end_at: at(date, end),
    location_id: null,
    task_id: `task-${id}`,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
    ...patch,
  };
}

const planned = (base: ScheduleItem, reason_code: ReasonCode | null = null): PlannedItem => ({
  ...base,
  reason_code,
});

const stored = (base: ScheduleItem, date: string, reason_code: ReasonCode | null, carried: boolean): PlanItemRow => ({
  ...base,
  user_id: USER_ID,
  weekly_plan_id: PLAN_ID,
  date,
  reason_code,
  carried,
});

// Before：ES（企業A）17:35〜18:35（進行中なので locked）、単語 19:00〜19:20
const esBefore = item("es", TODAY, "17:35", "18:35", { title: "ES（企業A）", locked: true, reason: "締切が近いため" });
const wordBefore = item("word", TODAY, "19:00", "19:20", { title: "英単語", reason: "軽い作業" });

// Engine：ES を now（18:00）で切り、18:00〜18:30 に休憩、ES の後半を火曜へ
const esCut = item("es", TODAY, "17:35", "18:00", {
  title: "ES（企業A）",
  locked: true,
  status: "completed",
  reason: "締切が近いため",
});
const rest = item("rest-new", TODAY, "18:00", "18:30", { kind: "free", title: "休憩", task_id: null, reason: "疲れたため休憩" });
const esTuesday = item("es-tue-new", TUESDAY, "20:00", "20:35", { title: "ES（企業A）", reason: "疲れたため移動" });

const result: Extract<EngineReplanResult, { ok: true }> = {
  ok: true,
  proposal: {
    date: TODAY,
    intent: {
      type: "state_change",
      fatigue: "high",
      task_changes: [],
      new_fixed_events: [],
      preference_changes: [],
    },
    before: { date: TODAY, items: [esBefore, wordBefore] },
    after: { date: TODAY, items: [esCut, rest, wordBefore] },
    changes: [
      { change_type: "replaced", before: esBefore, after: [esCut, rest], moved_to_date: null, reason: "REST" },
    ],
    other_day_changes: [
      { change_type: "moved", before: esBefore, after: [esTuesday], moved_to_date: TUESDAY, reason: "TIRED_MOVED" },
    ],
    summary_message: "疲れているので休憩を入れました。",
  },
  updated_days: [
    { date: TODAY, items: [planned(esCut), planned(rest, "REST"), planned(wordBefore)] },
    { date: TUESDAY, items: [planned(esTuesday, "TIRED_MOVED")] },
  ],
};

const storedRows = new Map<string, PlanItemRow>([
  ["es", stored(esBefore, TODAY, "DEADLINE_NEAR", true)],
  ["word", stored(wordBefore, TODAY, "LIGHT_TASK", false)],
]);

function build() {
  let n = 0;
  return buildReplanRows({
    result,
    storedRows,
    userId: USER_ID,
    weeklyPlanId: PLAN_ID,
    newId: () => `new-${++n}`,
  });
}

// 新しい id → 元の id（updated_days の並びから引く）
function rowsByOldId() {
  const { updatedDays } = build();
  const rows = updatedDays.flatMap((day) => day.items);
  const oldIds = result.updated_days.flatMap((day) => day.items.map((i) => i.id));
  return { rows, byOld: new Map(oldIds.map((id, i) => [id, rows[i]])) };
}

describe("buildReplanRows（plans-replan.md 12.2 の 8）", () => {
  it("Engine が now で切った進行中のタスクは、Engine の値（17:35〜18:00・completed・locked）で保存し、carried は保存されている値", () => {
    const es = rowsByOldId().byOld.get("es")!;
    expect(es.start_at).toBe(at(TODAY, "17:35"));
    expect(es.end_at).toBe(at(TODAY, "18:00"));
    expect(es.status).toBe("completed");
    expect(es.locked).toBe(true);
    expect(es.carried).toBe(true);
    expect(es.user_id).toBe(USER_ID);
    expect(es.weekly_plan_id).toBe(PLAN_ID);
    expect(es.date).toBe(TODAY);
  });

  it("変わっていない項目の reason_code は保存されている値のまま", () => {
    const { byOld } = rowsByOldId();
    expect(byOld.get("word")!.reason_code).toBe("LIGHT_TASK");
    // reason が同じなら、切った項目も保存されている reason_code を引き継ぐ
    expect(byOld.get("es")!.reason_code).toBe("DEADLINE_NEAR");
  });

  it("Engine の reason_code があればそれを使う", () => {
    const { byOld } = rowsByOldId();
    expect(byOld.get("rest-new")!.reason_code).toBe("REST");
    expect(byOld.get("es-tue-new")!.reason_code).toBe("TIRED_MOVED");
  });

  it("Engine が新しく作った項目の carried は false", () => {
    const { byOld } = rowsByOldId();
    expect(byOld.get("rest-new")!.carried).toBe(false);
    expect(byOld.get("es-tue-new")!.carried).toBe(false);
  });

  it("updated_days の全項目の id が元と違い、重複しない", () => {
    const { rows } = rowsByOldId();
    const oldIds = new Set(result.updated_days.flatMap((day) => day.items.map((i) => i.id)));
    const newIds = rows.map((row) => row.id);
    expect(newIds.every((id) => !oldIds.has(id))).toBe(true);
    expect(new Set(newIds).size).toBe(newIds.length);
  });

  it("proposal.after・changes[].after・other_day_changes[].after の id が updated_days の行の id と一致する", () => {
    const { updatedDays, proposal } = build();
    const rowIds = updatedDays.flatMap((day) => day.items.map((row) => row.id));
    const todayRowIds = updatedDays.find((day) => day.date === TODAY)!.items.map((row) => row.id);
    expect(proposal.after.items.map((i) => i.id)).toEqual(todayRowIds);
    for (const change of [...proposal.changes, ...proposal.other_day_changes]) {
      for (const after of change.after) expect(rowIds).toContain(after.id);
    }
    // 同じ元の id には同じ新しい id
    expect(proposal.changes[0].after.map((i) => i.id)).toEqual(todayRowIds.slice(0, 2));
    expect(proposal.other_day_changes[0].after[0].id).toBe(
      updatedDays.find((day) => day.date === TUESDAY)!.items[0].id,
    );
  });

  it("proposal.before・changes[].before・other_day_changes[].before の id は元のまま", () => {
    const { proposal } = build();
    expect(proposal.before.items.map((i) => i.id)).toEqual(["es", "word"]);
    expect(proposal.changes[0].before?.id).toBe("es");
    expect(proposal.other_day_changes[0].before?.id).toBe("es");
    // before の中身も変えない
    expect(proposal.changes[0].before?.end_at).toBe(at(TODAY, "18:35"));
  });
});
