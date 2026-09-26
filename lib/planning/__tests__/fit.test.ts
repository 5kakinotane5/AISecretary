import { describe, expect, it } from "vitest";
import { atJstTime } from "@/lib/datetime";
import type { DailyCheckin, PlanningContext, Task, TimeBand } from "@/lib/schemas";
import { computeTaskFit, type TaskFitInput } from "../fit";
import type { FreeSlot } from "../slots";
import { createPlanningContext } from "./fixtures";

const monday = "2026-10-05";

function task(context: PlanningContext, id = "task_report"): Task {
  const found = context.tasks.find((entry) => entry.id === id);
  if (!found) throw new Error(`${id}がありません`);
  return found;
}

function checkin(overrides: Partial<DailyCheckin>): DailyCheckin {
  return {
    date: monday,
    mood: null,
    fatigue: null,
    concentration: null,
    want_task_ids: [],
    avoid_task_ids: [],
    note: null,
    ...overrides,
  };
}

function slot(date = monday, start = "06:00", workEnd = "23:30"): FreeSlot {
  return {
    start: atJstTime(date, start),
    end: atJstTime(date, "24:00"),
    work_end: atJstTime(date, workEnd),
    location_id: "loc_home",
  };
}

function input(overrides: Partial<TaskFitInput> = {}): TaskFitInput {
  const context = createPlanningContext();
  return {
    context,
    task: task(context),
    slot: slot(),
    start: atJstTime(monday, "18:00"),
    minutes: 60,
    band: null,
    ...overrides,
  };
}

describe("computeTaskFit（planning.md P4）", () => {
  it.each([
    ["fatigue", { fatigue: "high" }],
    ["concentration", { concentration: "low" }],
  ] as const)("今日の%sで高集中タスクを0にする", (_name, state) => {
    const value = input();
    value.context.checkin = checkin(state);
    const result = computeTaskFit(value);
    expect(result.fit).toBe(0);
    expect(result.gate).toBe(0);
  });

  it("締切最終日は0の状態成分だけを0.3へ救済する", () => {
    const value = input();
    value.task.deadline_at = "2026-10-06T23:59:00+09:00";
    value.context.checkin = checkin({ fatigue: "high", concentration: "low" });
    const result = computeTaskFit(value);
    expect(result.concentration_fit).toBe(0.3);
    expect(result.fatigue_fit).toBe(0.3);
    expect(result.gate).toBe(1);
    expect(result.fit).toBeGreaterThan(0);
  });

  it("締切最終日でもwork_endの0は救済しない", () => {
    const value = input({ start: atJstTime(monday, "23:15"), minutes: 30 });
    value.task.deadline_at = "2026-10-06T23:59:00+09:00";
    expect(computeTaskFit(value).fit).toBe(0);
  });

  it("目標セッションをband外へ置くと0", () => {
    const value = input({ band: "evening", start: atJstTime(monday, "17:30") });
    value.task = task(value.context, "task_toeic_listening");
    expect(computeTaskFit(value).time_of_day_fit).toBe(0);
    expect(computeTaskFit(value).fit).toBe(0);
  });

  it.each([
    ["morning", "06:00", "60", 1],
    ["morning", "11:30", "30", 1],
    ["morning", "11:30", "31", 0],
    ["daytime", "12:00", "60", 1],
    ["daytime", "17:30", "30", 1],
    ["daytime", "17:30", "31", 0],
    ["evening", "18:00", "60", 1],
    ["evening", "23:00", "30", 1],
    ["evening", "23:00", "31", 0],
  ] as const)("%sの境界 start=%s L=%s", (band, start, minutes, expected) => {
    const value = input({ band: band as TimeBand, start: atJstTime(monday, start), minutes: Number(minutes) });
    value.task = task(value.context, "task_toeic_vocab");
    expect(computeTaskFit(value).time_of_day_fit).toBe(expected);
  });

  it("endがwork_endちょうどなら許可し、超えると0", () => {
    expect(computeTaskFit(input({ start: atJstTime(monday, "22:30"), minutes: 60 }))).toMatchObject({ time_of_day_fit: 0.5, gate: 1 });
    expect(computeTaskFit(input({ start: atJstTime(monday, "22:30"), minutes: 61 })).time_of_day_fit).toBe(0);
  });

  it.each([
    ["07:29", 0],
    ["07:30", 1],
    ["21:59", 1],
    ["22:00", 0.5],
    ["22:59", 0.5],
    ["23:00", 0],
  ])("高集中タスクの開始%sはTimeOfDayFit=%s", (start, expected) => {
    expect(computeTaskFit(input({ slot: slot(monday, "06:00", "24:00"), start: atJstTime(monday, start) })).time_of_day_fit).toBe(expected);
  });

  it("slot開始より前は0", () => {
    expect(computeTaskFit(input({ slot: slot(monday, "18:30"), start: atJstTime(monday, "18:00") })).time_of_day_fit).toBe(0);
  });

  it("分割不可の長さ不一致と、分割可の30分未満を0にする", () => {
    const unsplittable = input({ minutes: 14 });
    unsplittable.task = task(unsplittable.context, "task_mail");
    expect(computeTaskFit(unsplittable).duration_fit).toBe(0);
    expect(computeTaskFit(input({ minutes: 29 })).duration_fit).toBe(0);
  });

  it("interruptible=falseは開始からwork_endまでL+30分以上なら1、未満なら0.5", () => {
    expect(computeTaskFit(input({ start: atJstTime(monday, "22:00"), minutes: 60 })).interrupt_fit).toBe(1);
    expect(computeTaskFit(input({ start: atJstTime(monday, "22:01"), minutes: 60 })).interrupt_fit).toBe(0.5);
  });

  it("今日以外には今日のcheckinを反映しない", () => {
    const value = input({ slot: slot("2026-10-06"), start: atJstTime("2026-10-06", "18:00") });
    value.context.checkin = checkin({ fatigue: "high", concentration: "low" });
    expect(computeTaskFit(value)).toMatchObject({ concentration_fit: 1, fatigue_fit: 1, fit: 1 });
  });

  it("qとfitをconfigの重みどおり計算する", () => {
    const value = input({ start: atJstTime(monday, "22:00"), minutes: 60 });
    value.context.checkin = checkin({ fatigue: "medium" });
    const result = computeTaskFit(value);
    const expected = 0.15 + 0.25 * 0.5 + 0.2 + 0.2 * 0.6 + 0.1 + 0.1;
    expect(result.q).toBeCloseTo(expected, 12);
    expect(result.fit).toBeCloseTo(expected, 12);
  });

  it("入力を変更せず決定論的で、全数値が有限かつ0〜1", () => {
    const value = input();
    const before = structuredClone(value);
    const first = computeTaskFit(value);
    expect(JSON.stringify(computeTaskFit(value))).toBe(JSON.stringify(first));
    expect(value).toEqual(before);
    for (const number of Object.values(first)) {
      expect(Number.isFinite(number)).toBe(true);
      expect(number).toBeGreaterThanOrEqual(0);
      expect(number).toBeLessThanOrEqual(1);
    }
  });
});
