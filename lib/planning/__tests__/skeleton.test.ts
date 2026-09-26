import { describe, expect, it } from "vitest";
import { atJstTime, diffMinutes } from "@/lib/datetime";
import { EnginePlanSchema, InfeasibleSchema, PlannedItemSchema } from "@/lib/schemas";
import type { FixedEvent, PlanningContext } from "@/lib/schemas";
import { LOCATION_IDS } from "@/mocks/persona";
import { buildSkeleton, expandFixedEvents } from "../skeleton";
import { createPlanningContext } from "./fixtures";

const monday = "2026-10-05";
const { home, univ, cafe, station } = LOCATION_IDS;

describe("expandFixedEvents（backend.md 9.1.2）", () => {
  const weekly: FixedEvent = {
    id: "fixed_weekly",
    title: "ゼミ",
    category: "class",
    location_id: univ,
    start_at: "2026-10-13T09:00:00+09:00",
    end_at: "2026-10-13T10:30:00+09:00",
    recurrence: "weekly",
  };
  const single: FixedEvent = {
    id: "fixed_single",
    title: "面談",
    category: "other",
    location_id: cafe,
    start_at: "2026-10-08T14:00:00+09:00",
    end_at: "2026-10-08T15:00:00+09:00",
    recurrence: null,
  };

  it("毎週の予定を開始日より前を含む範囲内の全週へ展開する", () => {
    const result = expandFixedEvents([weekly], "2026-09-28", "2026-10-18", {
      purpose: "planning_context",
    });
    expect(result.map((entry) => entry.start_at)).toEqual([
      "2026-09-29T09:00:00+09:00",
      "2026-10-06T09:00:00+09:00",
      "2026-10-13T09:00:00+09:00",
    ]);
    expect(result.every((entry) => entry.id === weekly.id)).toBe(true);
    expect(result.every((entry) => diffMinutes(entry.start_at, entry.end_at) === 90)).toBe(true);
  });

  it("単発予定は元の日時が範囲内にあるときだけ返す", () => {
    expect(
      expandFixedEvents([single], "2026-10-05", "2026-10-11", {
        purpose: "planning_context",
      }),
    ).toEqual([single]);
    expect(
      expandFixedEvents([single], "2026-10-09", "2026-10-11", {
        purpose: "planning_context",
      }),
    ).toEqual([]);
  });

  it("カレンダー用は元の日付だけ元ID、別の日付は日付付きIDにする", () => {
    const result = expandFixedEvents([weekly], "2026-10-05", "2026-10-20", {
      purpose: "calendar",
    });
    expect(result.map(({ id, start_at }) => [id, start_at])).toEqual([
      ["fixed_weekly_2026-10-06", "2026-10-06T09:00:00+09:00"],
      ["fixed_weekly", "2026-10-13T09:00:00+09:00"],
      ["fixed_weekly_2026-10-20", "2026-10-20T09:00:00+09:00"],
    ]);
  });

  it("入力を変更せず、同じ入力から同じ結果を返す", () => {
    const input = [weekly, single];
    const before = structuredClone(input);
    const first = expandFixedEvents(input, "2026-10-01", "2026-10-31", {
      purpose: "calendar",
    });
    const second = expandFixedEvents(input, "2026-10-01", "2026-10-31", {
      purpose: "calendar",
    });
    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first).not.toBe(input);
  });
});

function event(
  id: string,
  start: string,
  end: string,
  location: FixedEvent["location_id"],
): FixedEvent {
  return {
    id,
    title: id,
    category: "other",
    location_id: location,
    start_at: atJstTime(monday, start),
    end_at: atJstTime(monday, end),
    recurrence: null,
  };
}

function successful(context = createPlanningContext()) {
  const result = buildSkeleton(context);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.infeasible.reason);
  return result;
}

function failed(context: PlanningContext) {
  const before = structuredClone(context);
  const result = buildSkeleton(context);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("infeasibleを期待しました");
  expect(InfeasibleSchema.parse(result.infeasible)).toEqual(result.infeasible);
  expect(result.infeasible.reason.length).toBeGreaterThan(0);
  expect(result.infeasible.required_changes.length).toBeGreaterThan(0);
  expect(context).toEqual(before);
  return result.infeasible;
}

describe("buildSkeleton（planning.md 10.4・10.14）", () => {
  it("月〜日の7日分を作り、nowより前の骨組みと展開済み固定予定を保持する", () => {
    const context = createPlanningContext();
    context.now = "2026-10-07T18:00:00+09:00";
    const { days } = successful(context);
    expect(days.map((day) => day.date)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(days[0].items[0].start_at).toBe("2026-10-05T00:00:00+09:00");
    const fixed = days.flatMap((day) => day.items).filter((item) => item.kind === "fixed");
    expect(fixed).toHaveLength(context.fixed_events.length);
    for (const source of context.fixed_events) {
      const matching = fixed.filter((item) => item.fixed_event_id === source.id);
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({
        title: source.title,
        start_at: source.start_at,
        end_at: source.end_at,
        fixed_category: source.category,
        location_id: source.location_id,
        fixed_event_id: source.id,
      });
    }
  });

  it("月曜の往路は8:10〜9:00、復路は13:00〜13:50で、大学内では移動しない", () => {
    const { days } = successful();
    const travel = days[0].items.filter((item) => item.kind === "travel");
    expect(travel).toHaveLength(2);
    expect(travel[0]).toMatchObject({
      title: "移動 自宅→架空大学 つばさキャンパス",
      start_at: "2026-10-05T08:10:00+09:00",
      end_at: "2026-10-05T09:00:00+09:00",
      location_id: null,
      travel: { from_location_id: home, to_location_id: univ, mode: "walk_train" },
    });
    expect(travel[1]).toMatchObject({
      title: "移動 架空大学 つばさキャンパス→自宅",
      start_at: "2026-10-05T13:00:00+09:00",
      end_at: "2026-10-05T13:50:00+09:00",
      travel: { from_location_id: univ, to_location_id: home, mode: "walk_train" },
    });
  });

  it.each([
    ["2026-10-05", "2026-10-06", "2026-10-11", "2026-10-12"],
    ["2026-12-28", "2026-12-29", "2027-01-03", "2027-01-04"],
    ["2028-02-28", "2028-02-29", "2028-03-05", "2028-03-06"],
  ])("23:30〜7:00の睡眠を日付境界で分割する（週初め %s）", (start, next, last, end) => {
    const context = createPlanningContext();
    context.week_start = start;
    context.now = `${start}T07:00:00+09:00`;
    context.fixed_events = [];
    context.preferences.sleep_start = "23:30";
    context.preferences.sleep_end = "07:00";
    const { days } = successful(context);
    expect(days.every((day) => day.items.length === 2)).toBe(true);
    expect(days[0].items).toMatchObject([
      {
        kind: "sleep",
        location_id: home,
        start_at: `${start}T00:00:00+09:00`,
        end_at: `${start}T07:00:00+09:00`,
      },
      {
        kind: "sleep",
        location_id: home,
        start_at: `${start}T23:30:00+09:00`,
        end_at: `${next}T00:00:00+09:00`,
      },
    ]);
    expect(days[6].date).toBe(last);
    expect(days[6].items[1].end_at).toBe(`${end}T00:00:00+09:00`);
    expect(
      days.flatMap((day) => day.items).every((item) => diffMinutes(item.start_at, item.end_at) > 0),
    ).toBe(true);
  });

  it.each([
    ["00:00", "07:30"],
    ["23:30", "00:00"],
  ])("睡眠 %s〜%s では長さ0の項目を作らない", (start, end) => {
    const context = createPlanningContext();
    context.fixed_events = [];
    context.preferences.sleep_start = start;
    context.preferences.sleep_end = end;
    const { days } = successful(context);
    expect(days.every((day) => day.items.length === 1 && day.items[0].kind === "sleep")).toBe(true);
    expect(days.every((day) => diffMinutes(day.items[0].start_at, day.items[0].end_at) > 0)).toBe(
      true,
    );
  });

  it("固定予定がない日は睡眠だけで、移動時間表も不要", () => {
    const context = createPlanningContext();
    context.fixed_events = [];
    context.travel_times = [];
    const { days } = successful(context);
    expect(days.every((day) => day.items.length === 1 && day.items[0].kind === "sleep")).toBe(true);
  });

  it("同じ場所の予定間に長い隙間があっても、一時帰宅しない", () => {
    const context = createPlanningContext();
    context.fixed_events = [
      event("午前の授業", "09:00", "10:00", univ),
      event("午後の授業", "15:00", "16:00", univ),
    ];
    const travel = successful(context).days[0].items.filter((item) => item.kind === "travel");
    expect(travel).toHaveLength(2);
    expect(travel[1].start_at).toBe("2026-10-05T16:00:00+09:00");
  });

  it("自宅だけの固定予定では移動しない", () => {
    const context = createPlanningContext();
    context.fixed_events = [
      event("朝の予定", "09:00", "10:00", home),
      event("昼の予定", "12:00", "13:00", home),
    ];
    context.travel_times = [];
    expect(successful(context).days[0].items.filter((item) => item.kind === "travel")).toEqual([]);
  });

  it("場所nullの予定は直前の場所で過ごし、nullを保持したままその終了後に出発する", () => {
    const context = createPlanningContext();
    context.fixed_events = [
      event("授業", "09:00", "10:00", univ),
      event("場所不明の予定", "10:30", "11:00", null),
      event("自宅の予定", "13:00", "14:00", home),
    ];
    const items = successful(context).days[0].items;
    expect(items.find((item) => item.fixed_event_id === "場所不明の予定")?.location_id).toBeNull();
    const travel = items.filter((item) => item.kind === "travel");
    expect(travel).toHaveLength(2);
    expect(travel[1]).toMatchObject({
      start_at: "2026-10-05T11:00:00+09:00",
      end_at: "2026-10-05T11:50:00+09:00",
    });
  });

  it("自宅以外からは直後に出発し、12分・3分の移動を丸めず使う", () => {
    const context = createPlanningContext();
    context.fixed_events = [
      event("カフェ", "09:00", "10:00", cafe),
      event("駅前", "10:03", "11:00", station),
    ];
    const travel = successful(context).days[0].items.filter((item) => item.kind === "travel");
    expect(travel.map((item) => diffMinutes(item.start_at, item.end_at))).toEqual([12, 3, 12]);
    expect(travel[0].start_at).toBe("2026-10-05T08:48:00+09:00");
    expect(travel[1]).toMatchObject({
      start_at: "2026-10-05T10:00:00+09:00",
      end_at: "2026-10-05T10:03:00+09:00",
    });
    expect(travel[2].start_at).toBe("2026-10-05T11:00:00+09:00");
  });

  it.each([
    [home, univ],
    [univ, home],
    [univ, cafe],
  ])("必要な有向経路 %s→%s がなければinfeasible", (from, to) => {
    const context = createPlanningContext();
    context.travel_times = context.travel_times.filter(
      (route) => !(route.from_location_id === from && route.to_location_id === to),
    );
    const result = failed(context);
    expect(result.reason).toContain("移動時間表");
    expect(result.reason).toContain(
      context.locations.find((location) => location.id === from)!.name,
    );
    expect(result.reason).toContain(context.locations.find((location) => location.id === to)!.name);
  });

  it("自宅発の移動が直前の固定予定に重なればinfeasible", () => {
    const context = createPlanningContext();
    context.fixed_events = [
      event("朝食", "07:30", "08:30", home),
      event("授業", "09:00", "10:00", univ),
    ];
    expect(failed(context).reason).toContain("朝食と授業の間の移動時間が足りません");
  });

  it("自宅以外発の移動が次の予定に重なればinfeasible", () => {
    const context = createPlanningContext();
    context.fixed_events = [
      event("授業", "09:00", "10:00", univ),
      event("バイト", "10:20", "11:00", cafe),
    ];
    expect(failed(context).reason).toContain("授業とバイトの間の移動時間が足りません");
  });

  it("最初の往路が睡眠に重なればinfeasible", () => {
    const context = createPlanningContext();
    context.fixed_events = [event("早朝の授業", "07:50", "09:00", univ)];
    expect(failed(context).reason).toContain("睡眠と早朝の授業の間の移動時間が足りません");
  });

  it("最後の復路が就寝に重なればinfeasible", () => {
    const context = createPlanningContext();
    context.preferences.sleep_start = "23:30";
    context.fixed_events = [event("夜の授業", "22:00", "23:00", univ)];
    expect(failed(context).reason).toContain("夜の授業と睡眠の間の移動時間が足りません");
  });

  it.each(["出発", "帰宅"])("%sの移動が日付境界を超えればinfeasible", (direction) => {
    const context = createPlanningContext();
    if (direction === "出発") {
      context.preferences.sleep_start = "13:00";
      context.preferences.sleep_end = "14:00";
      context.fixed_events = [event("深夜の予定", "00:20", "01:00", univ)];
    } else {
      context.fixed_events = [event("深夜の予定", "23:00", "23:30", univ)];
    }
    expect(failed(context).reason).toContain("日付の");
  });

  it.each(["固定予定", "睡眠"])("%sと重なる固定予定を成功として返さない", (conflict) => {
    const context = createPlanningContext();
    context.fixed_events =
      conflict === "睡眠"
        ? [event("朝の予定", "07:00", "08:00", home)]
        : [event("予定A", "09:00", "10:00", home), event("予定B", "09:30", "10:30", home)];
    expect(failed(context).reason).toContain("重なっています");
  });

  it("全項目がスキーマに適合し、locked・理由nullで重複しない", () => {
    const context = createPlanningContext();
    const { days } = successful(context);
    expect(EnginePlanSchema.shape.days.parse(days)).toEqual(days);
    const all = days.flatMap((day) => day.items);
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
    for (const day of days) {
      for (const [index, item] of day.items.entries()) {
        expect(PlannedItemSchema.parse(item)).toEqual(item);
        expect(["sleep", "fixed", "travel"]).toContain(item.kind);
        expect(item).toMatchObject({
          locked: true,
          reason_code: null,
          reason: null,
          task_id: null,
          suggested_task_id: null,
          status: "planned",
        });
        expect(diffMinutes(item.start_at, item.end_at)).toBeGreaterThan(0);
        if (index > 0)
          expect(diffMinutes(day.items[index - 1].end_at, item.start_at)).toBeGreaterThanOrEqual(0);
        if (item.travel) {
          const route = context.travel_times.find(
            (route) =>
              route.from_location_id === item.travel!.from_location_id &&
              route.to_location_id === item.travel!.to_location_id,
          );
          expect(diffMinutes(item.start_at, item.end_at)).toBe(route?.minutes);
        }
      }
    }
  });

  it.each([null, "intensive", "balanced", "relaxed"] as const)(
    "style=%sの仮IDが日ごとの時刻順で決まる",
    (style) => {
      const context = createPlanningContext();
      context.style = style;
      const { days } = successful(context);
      for (const day of days) {
        expect(day.items.map((item) => item.id)).toEqual(
          day.items.map((_, index) => `tmp_${style ?? "shared"}_${day.date}_${index + 1}`),
        );
      }
    },
  );

  it("繰り返し実行と入力配列の順序変更で結果が変わらず、入力を変更しない", () => {
    const context = createPlanningContext();
    const original = structuredClone(context);
    const first = successful(context);
    expect(buildSkeleton(context)).toEqual(first);
    expect(context).toEqual(original);
    const reordered = structuredClone(context);
    reordered.fixed_events.reverse();
    reordered.locations.reverse();
    reordered.travel_times.reverse();
    expect(buildSkeleton(reordered)).toEqual(first);
    first.days[0].items[0].title = "出力側だけ変更";
    expect(context).toEqual(original);
  });
});
