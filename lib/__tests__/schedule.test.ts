import { describe, expect, it } from "vitest";
import { mergeFreeTime, sumFreeTimeMinutes } from "@/lib/schedule";
import type { ScheduleItem } from "@/lib/schemas";

function item(
  id: string,
  kind: ScheduleItem["kind"],
  start: string,
  end: string,
  extra: Partial<ScheduleItem> = {},
): ScheduleItem {
  return {
    id,
    kind,
    title: kind === "buffer" ? "バッファ" : kind === "free" ? "自由時間" : id,
    start_at: `2026-10-05T${start}:00+09:00`,
    end_at: `2026-10-05T${end}:00+09:00`,
    location_id: "loc_home",
    task_id: null,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
    ...extra,
  };
}

describe("mergeFreeTime（画面表示用に自由時間をまとめる）", () => {
  it("buffer は free・「空き時間」として表示する", () => {
    const [merged] = mergeFreeTime([item("b1", "buffer", "13:50", "14:05")]);
    expect(merged.kind).toBe("free");
    expect(merged.title).toBe("空き時間");
    expect(merged.id).toBe("b1");
  });

  it("free（DB の title は「自由時間」）も「空き時間」として表示する", () => {
    const [merged] = mergeFreeTime([item("f1", "free", "13:50", "14:05")]);
    expect(merged.kind).toBe("free");
    expect(merged.title).toBe("空き時間");
  });

  it("隣り合う buffer と free を1つにまとめる（id・start_at は最初、end_at は最後）", () => {
    const result = mergeFreeTime([
      item("t1", "task", "17:00", "18:00"),
      item("b1", "buffer", "18:05", "18:20"),
      item("f1", "free", "18:20", "19:00"),
    ]);
    expect(result.map((i) => i.id)).toEqual(["t1", "b1"]);
    expect(result[1]).toMatchObject({
      kind: "free",
      start_at: "2026-10-05T18:05:00+09:00",
      end_at: "2026-10-05T19:00:00+09:00",
    });
  });

  it("時刻順に並べてからまとめる", () => {
    const result = mergeFreeTime([item("f1", "free", "18:20", "19:00"), item("b1", "buffer", "18:05", "18:20")]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b1");
  });

  it("場所が違えばまとめない", () => {
    const result = mergeFreeTime([
      item("b1", "buffer", "18:05", "18:20"),
      item("f1", "free", "18:20", "19:00", { location_id: "loc_school" }),
    ]);
    expect(result.map((i) => i.id)).toEqual(["b1", "f1"]);
  });

  it("間が空いていればまとめない", () => {
    const result = mergeFreeTime([item("b1", "buffer", "18:05", "18:20"), item("f1", "free", "18:30", "19:00")]);
    expect(result.map((i) => i.id)).toEqual(["b1", "f1"]);
  });

  it("候補タスクと理由をまとめた後も残す（複数あれば合わせる）", () => {
    const [merged] = mergeFreeTime([
      item("b1", "buffer", "13:50", "14:05", { suggested_task_id: "task_mail", reason: "移動の前に余裕を残すため" }),
      item("f1", "free", "14:05", "14:30"),
      item("b2", "buffer", "14:30", "14:45", { suggested_task_id: "task_es", reason: "移動の前に余裕を残すため" }),
    ]);
    expect(merged.suggested_task_id).toBe("task_mail");
    expect(merged.suggested_task_ids).toEqual(["task_mail", "task_es"]);
    expect(merged.reason).toBe("移動の前に余裕を残すため");
  });

  it("元の配列は変えない", () => {
    const items = [item("b1", "buffer", "18:05", "18:20"), item("f1", "free", "18:20", "19:00")];
    mergeFreeTime(items);
    expect(items[0].kind).toBe("buffer");
    expect(items[0].end_at).toBe("2026-10-05T18:20:00+09:00");
  });

  it("自由時間の合計は buffer＋free", () => {
    expect(
      sumFreeTimeMinutes([
        item("b1", "buffer", "18:05", "18:20"),
        item("f1", "free", "18:20", "19:00"),
        item("t1", "task", "19:00", "20:00"),
      ]),
    ).toBe(55);
  });
});
