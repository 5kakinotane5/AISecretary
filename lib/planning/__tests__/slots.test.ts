import { describe, expect, it } from "vitest";
import { atJstTime, diffMinutesExact } from "@/lib/datetime";
import type { PlanningContext, ScheduleItem } from "@/lib/schemas";
import { LOCATION_IDS } from "@/mocks/persona";
import { buildSkeleton } from "../skeleton";
import { buildFreeSlots, computeWeeklyFreeMinutes, WeeklyFreeMinutesError } from "../slots";
import { createPlanningContext } from "./fixtures";

const monday = "2026-10-05";
const sunday = "2026-10-11";
const { home, univ } = LOCATION_IDS;

function skeleton(context: PlanningContext) {
  const result = buildSkeleton(context);
  if (!result.ok) throw new Error(result.infeasible.reason);
  return result.days;
}

function hold(
  date: string,
  start: string,
  end: string,
  kind: ScheduleItem["kind"] = "task",
): ScheduleItem {
  return {
    id: `${kind}_${date}_${start}`,
    kind,
    title: "保持する項目",
    start_at: atJstTime(date, start),
    end_at: atJstTime(date, end),
    location_id: home,
    task_id: kind === "task" ? "task_research" : null,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: true,
    status: "planned",
    reason: null,
  };
}

function slotsFor(context: PlanningContext, date = monday) {
  return buildFreeSlots(context, skeleton(context)).filter((slot) => slot.start.startsWith(date));
}

describe("buildFreeSlots（planning.md 10.5）", () => {
  it("月曜は13:50〜19:00・19:45〜24:00で、帰宅後の場所と23:30の作業終了を保つ", () => {
    expect(slotsFor(createPlanningContext())).toEqual([
      {
        start: "2026-10-05T13:50:00+09:00",
        end: "2026-10-05T19:00:00+09:00",
        work_end: "2026-10-05T19:00:00+09:00",
        location_id: home,
      },
      {
        start: "2026-10-05T19:45:00+09:00",
        end: "2026-10-06T00:00:00+09:00",
        work_end: "2026-10-05T23:30:00+09:00",
        location_id: home,
      },
    ]);
  });

  it("火曜の朝や水曜の大学での空きも失わない", () => {
    const context = createPlanningContext();
    const slots = buildFreeSlots(context, skeleton(context));
    expect(slots).toEqual(
      expect.arrayContaining([
        {
          start: "2026-10-06T08:00:00+09:00",
          end: "2026-10-06T11:30:00+09:00",
          work_end: "2026-10-06T11:30:00+09:00",
          location_id: home,
        },
        {
          start: "2026-10-07T13:00:00+09:00",
          end: "2026-10-07T14:40:00+09:00",
          work_end: "2026-10-07T14:40:00+09:00",
          location_id: univ,
        },
      ]),
    );
  });

  it.each([
    ["14:12:00", "14:15:00"],
    ["14:15:00", "14:15:00"],
    ["14:15:01", "14:20:00"],
    ["14:15:00.001", "14:20:00"],
  ])("now=%sを5分単位に切り上げる", (now, start) => {
    const context = createPlanningContext();
    context.now = `${monday}T${now}+09:00`;
    expect(slotsFor(context)[0].start).toBe(`${monday}T${start}+09:00`);
  });

  it.each([
    ["07:44:00", false],
    ["07:44:59", false],
    ["07:45:00", true],
  ])("15分未満は除外し、15分ちょうどは残す（隙間の終わり%s）", (end, kept) => {
    const context = createPlanningContext();
    context.fixed_events = [];
    const retained = hold(monday, "07:45", "08:00");
    retained.start_at = `${monday}T${end}+09:00`;
    context.locked_items = [retained];
    const morning = slotsFor(context).find((slot) => slot.start === "2026-10-05T07:30:00+09:00");
    expect(Boolean(morning)).toBe(kept);
    if (morning) expect(diffMinutesExact(morning.start, morning.end)).toBe(15);
  });

  it("nowによる切り詰め後に15分未満になる空きも除外する", () => {
    const context = createPlanningContext();
    context.now = "2026-10-05T18:47:00+09:00";
    expect(slotsFor(context).map((slot) => slot.start)).toEqual(["2026-10-05T19:45:00+09:00"]);
  });

  it.each(["task", "buffer", "free"] as const)("保持対象の%sが占める時間を除外する", (kind) => {
    const context = createPlanningContext();
    context.locked_items = [hold(monday, "14:30", "15:30", kind)];
    expect(slotsFor(context).map((slot) => [slot.start, slot.end])).toEqual([
      ["2026-10-05T13:50:00+09:00", "2026-10-05T14:30:00+09:00"],
      ["2026-10-05T15:30:00+09:00", "2026-10-05T19:00:00+09:00"],
      ["2026-10-05T19:45:00+09:00", "2026-10-06T00:00:00+09:00"],
    ]);
  });

  it("進行中の保持タスクの終了より前を空きにしない", () => {
    const context = createPlanningContext();
    context.now = "2026-10-05T14:12:00+09:00";
    context.locked_items = [hold(monday, "13:50", "14:40")];
    expect(slotsFor(context)[0].start).toBe("2026-10-05T14:40:00+09:00");
  });

  it("進行中の移動を二重に取り込まず、到着後の場所を使う", () => {
    const context = createPlanningContext();
    context.now = "2026-10-05T13:20:00+09:00";
    const days = skeleton(context);
    const travel = days[0].items.find(
      (entry) => entry.kind === "travel" && entry.travel?.to_location_id === home,
    )!;
    context.locked_items = [{ ...travel, id: "DB保存後の別ID" }];
    expect(buildFreeSlots(context, days)[0]).toMatchObject({
      start: "2026-10-05T13:50:00+09:00",
      location_id: home,
    });
  });

  it.each(["free", "buffer"] as const)("nowをまたぐ%sの保持された前半だけを除外する", (kind) => {
    const context = createPlanningContext();
    context.now = "2026-10-05T14:12:00+09:00";
    // plans-replan.md 12.2のadapterが切り出した前半。後半はlocked_itemsに入らない。
    context.locked_items = [hold(monday, "13:50", "14:12", kind)];
    expect(slotsFor(context)[0]).toMatchObject({
      start: "2026-10-05T14:15:00+09:00",
      end: "2026-10-05T19:00:00+09:00",
    });
  });

  it("骨組みの全コピーをlocked_itemsに入れても空きと合計は変わらない", () => {
    const context = createPlanningContext();
    const days = skeleton(context);
    const expected = buildFreeSlots(context, days);
    context.locked_items = days.flatMap((day) =>
      day.items.map((item) => ({ ...item, id: `saved_${item.id}` })),
    );
    expect(buildFreeSlots(context, days)).toEqual(expected);
  });

  it("重複・包含する保持区間は和集合として除外し、cursorを戻さない", () => {
    const context = createPlanningContext();
    context.locked_items = [
      hold(monday, "13:50", "15:00"),
      hold(monday, "14:30", "16:00"),
      hold(monday, "14:40", "14:50"),
      hold(monday, "13:50", "15:00"),
    ];
    expect(slotsFor(context)[0].start).toBe("2026-10-05T16:00:00+09:00");
  });

  it("場所nullの保持項目の後も直前の大学の場所を引き継ぐ", () => {
    const context = createPlanningContext();
    context.locked_items = [{ ...hold("2026-10-07", "13:00", "13:30"), location_id: null }];
    expect(slotsFor(context, "2026-10-07")).toContainEqual({
      start: "2026-10-07T13:30:00+09:00",
      end: "2026-10-07T14:40:00+09:00",
      work_end: "2026-10-07T14:40:00+09:00",
      location_id: univ,
    });
  });

  it("週の途中では過去の日の空きを作らない", () => {
    const context = createPlanningContext();
    context.now = "2026-10-08T12:47:00+09:00";
    const slots = buildFreeSlots(context, skeleton(context));
    expect(slots[0].start).toBe("2026-10-08T12:50:00+09:00");
    expect(slots.every((slot) => diffMinutesExact(context.now, slot.start) >= 0)).toBe(true);
  });

  it("土曜深夜の切り上げは日曜へ進み、睡眠の後から空きを返す", () => {
    const context = createPlanningContext();
    context.fixed_events = [];
    context.now = "2026-10-10T23:58:00+09:00";
    expect(buildFreeSlots(context, skeleton(context))[0].start).toBe("2026-10-11T07:30:00+09:00");
  });

  it("年をまたぐ週でも切り上げと週末境界が正しい", () => {
    const context = createPlanningContext();
    context.fixed_events = [];
    context.week_start = "2026-12-28";
    context.now = "2026-12-31T23:59:59+09:00";
    const slots = buildFreeSlots(context, skeleton(context));
    expect(slots[0].start).toBe("2027-01-01T07:30:00+09:00");
    expect(slots.at(-1)?.end).toBe("2027-01-04T00:00:00+09:00");
  });

  it.each(["23:56:00", "23:59:59"])("日曜%sの切り上げで翌週の空きを作らない", (time) => {
    const context = createPlanningContext();
    context.now = `${sunday}T${time}+09:00`;
    expect(buildFreeSlots(context, skeleton(context))).toEqual([]);
    expect(computeWeeklyFreeMinutes(context)).toBe(0);
  });

  it.each([
    ["00:00", "23:40", "2026-10-12T00:00:00+09:00"],
    ["23:30", "23:10", "2026-10-11T23:30:00+09:00"],
  ])("就寝%sの直前だけの空きは作業可能0分で保持する", (sleepStart, now, end) => {
    const context = createPlanningContext();
    context.preferences.sleep_start = sleepStart;
    context.now = atJstTime(sunday, now);
    const slots = buildFreeSlots(context, skeleton(context));
    expect(slots).toEqual([{ start: context.now, end, work_end: context.now, location_id: home }]);
    expect(computeWeeklyFreeMinutes(context)).toBe(0);
  });

  it("日をまたぐ睡眠の前30分を除き、endは就寝時刻まで残す", () => {
    const context = createPlanningContext();
    context.preferences.sleep_start = "23:30";
    const slots = slotsFor(context);
    expect(slots[1]).toMatchObject({
      end: "2026-10-05T23:30:00+09:00",
      work_end: "2026-10-05T23:00:00+09:00",
    });
  });

  it("00:15就寝では深夜の空きは0分、起床後は翌日の就寝前23:45まで作業可能", () => {
    const context = createPlanningContext();
    context.fixed_events = [];
    context.preferences.sleep_start = "00:15";
    context.now = atJstTime(sunday, "00:00");
    const slots = buildFreeSlots(context, skeleton(context));
    expect(slots).toEqual([
      {
        start: context.now,
        end: atJstTime(sunday, "00:15"),
        work_end: context.now,
        location_id: home,
      },
      {
        start: atJstTime(sunday, "07:30"),
        end: "2026-10-12T00:00:00+09:00",
        work_end: atJstTime(sunday, "23:45"),
        location_id: home,
      },
    ]);
  });

  it("前日から継続する保持対象が翌日の空きに食い込まない", () => {
    const context = createPlanningContext();
    context.fixed_events = [];
    context.now = atJstTime(sunday, "07:00");
    context.locked_items = [
      { ...hold("2026-10-10", "23:00", "23:30"), end_at: atJstTime(sunday, "08:00") },
    ];
    expect(buildFreeSlots(context, skeleton(context))[0].start).toBe(atJstTime(sunday, "08:00"));
  });

  it("入力を変更せず、同じ入力・配列の順序変更から同じ結果を返す", () => {
    const context = createPlanningContext();
    context.locked_items = [hold(monday, "14:00", "15:00"), hold(monday, "16:00", "17:00")];
    const days = skeleton(context);
    const beforeContext = structuredClone(context);
    const beforeDays = structuredClone(days);
    const result = buildFreeSlots(context, days);
    expect(buildFreeSlots(context, days)).toEqual(result);
    expect(computeWeeklyFreeMinutes(context)).toBeGreaterThan(0);
    expect(context).toEqual(beforeContext);
    expect(days).toEqual(beforeDays);
    expect(
      buildFreeSlots(
        { ...context, locked_items: [...context.locked_items].reverse() },
        [...days].reverse().map((day) => ({ ...day, items: [...day.items].reverse() })),
      ),
    ).toEqual(result);
  });
});

describe("computeWeeklyFreeMinutes", () => {
  it("スロットの作業可能分数の合計と一致する", () => {
    const context = createPlanningContext();
    const slots = buildFreeSlots(context, skeleton(context));
    expect(computeWeeklyFreeMinutes(context)).toBe(
      slots.reduce((sum, slot) => sum + diffMinutesExact(slot.start, slot.work_end), 0),
    );
    expect(computeWeeklyFreeMinutes(context)).toBeGreaterThan(0);
  });

  it("goals・tasksが空でも計算できる", () => {
    const context = createPlanningContext();
    const expected = computeWeeklyFreeMinutes(context);
    context.goals = [];
    context.tasks = [];
    context.goal_time_bands = {};
    context.goal_done_minutes = {};
    context.goal_week_target_minutes = {};
    expect(computeWeeklyFreeMinutes(context)).toBe(expected);
  });

  it("睡眠のみの週は1日16時間×7日で、就寝前30分を数えない", () => {
    const context = createPlanningContext();
    context.fixed_events = [];
    expect(computeWeeklyFreeMinutes(context)).toBe(16 * 60 * 7);
  });

  it("15分未満の隙間と保持対象の時間を合計に含めない", () => {
    const context = createPlanningContext();
    context.fixed_events = [];
    const expected = computeWeeklyFreeMinutes(context);
    context.locked_items = [hold(monday, "07:40", "08:00")];
    // 7:30〜7:40の10分は除外、7:40〜8:00の20分は占有。
    expect(computeWeeklyFreeMinutes(context)).toBe(expected - 30);
  });

  it("骨組みが成立しない場合は正常な0分ではなく理由を持つ例外を返す", () => {
    const context = createPlanningContext();
    context.travel_times = [];
    const before = structuredClone(context);
    const result = buildSkeleton(context);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("骨組みの失敗を期待しました");
    expect(() => computeWeeklyFreeMinutes(context)).toThrow(WeeklyFreeMinutesError);
    try {
      computeWeeklyFreeMinutes(context);
    } catch (error) {
      expect(error).toBeInstanceOf(WeeklyFreeMinutesError);
      if (!(error instanceof WeeklyFreeMinutesError)) throw error;
      expect(error.infeasible).toEqual(result.infeasible);
      expect(error.message).toBe(result.infeasible.reason);
    }
    expect(context).toEqual(before);
  });
});
