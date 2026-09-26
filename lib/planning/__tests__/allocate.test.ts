import { describe, expect, it } from "vitest";
import { addDays, atJstTime } from "@/lib/datetime";
import type { PlanningContext } from "@/lib/schemas";
import {
  buildWeeklyAllocation,
  buildWeeklyAllocations,
  type AllocationParameters,
  type WeeklyAllocation,
} from "../allocate";
import { computeTaskPriorities } from "../priority";
import { buildSkeleton } from "../skeleton";
import { buildFreeSlots, type FreeSlot } from "../slots";
import { createPlanningContext } from "./fixtures";

const monday = "2026-10-05";

function fixtureSlots(context: PlanningContext): FreeSlot[] {
  const skeleton = buildSkeleton(context);
  if (!skeleton.ok) throw new Error(skeleton.infeasible.reason);
  return buildFreeSlots(context, skeleton.days);
}

function parameters(overrides: Partial<AllocationParameters> = {}): AllocationParameters {
  return { rho: 0.45, kappa: 0, goal_order: "early", ...overrides };
}

function allocation(context = createPlanningContext(), overrides: Partial<AllocationParameters> = {}) {
  return buildWeeklyAllocation(context, fixtureSlots(context), parameters(overrides));
}

function taskQuotas(result: WeeklyAllocation, taskId: string) {
  return result.days.flatMap((day) => day.quotas
    .filter((quota) => quota.task_id === taskId)
    .map((quota) => ({ date: day.date, ...quota })));
}

function goalQuotas(result: WeeklyAllocation) {
  return result.days.flatMap((day) => day.quotas
    .filter((quota) => quota.kind === "goal")
    .map((quota) => ({ date: day.date, ...quota })));
}

function uniformSlots(minutesByDay: number[]): FreeSlot[] {
  return minutesByDay.map((minutes, index) => {
    const date = addDays(monday, index);
    const start = atJstTime(date, "08:00");
    return { start, end: atJstTime(date, "24:00"), work_end: atJstTime(date, `${String(8 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`), location_id: "loc_home" };
  });
}

describe("buildWeeklyAllocation（planning.md P3）", () => {
  it("rho=0.45でレポートを月・火・水に60分ずつ、完了目標日を水曜にする", () => {
    expect(taskQuotas(allocation(), "task_report")).toEqual([
      expect.objectContaining({ date: "2026-10-05", minutes: 60, completion_target_date: "2026-10-07" }),
      expect.objectContaining({ date: "2026-10-06", minutes: 60, completion_target_date: "2026-10-07" }),
      expect.objectContaining({ date: "2026-10-07", minutes: 60, completion_target_date: "2026-10-07" }),
    ]);
  });

  it("rho=0.45でESを月・木に60分ずつ、完了目標日を木曜にする", () => {
    expect(taskQuotas(allocation(), "task_es_a")).toEqual([
      expect.objectContaining({ date: "2026-10-05", minutes: 60, completion_target_date: "2026-10-08" }),
      expect.objectContaining({ date: "2026-10-08", minutes: 60, completion_target_date: "2026-10-08" }),
    ]);
  });

  it("すべての割り振り案に月曜の目標セッションがあり、合計はR=360", () => {
    const context = createPlanningContext();
    const results = buildWeeklyAllocations(context, fixtureSlots(context));
    for (const result of results) {
      expect(goalQuotas(result).some((quota) => quota.date === monday)).toBe(true);
      expect(goalQuotas(result).reduce((sum, quota) => sum + quota.minutes, 0)).toBe(360);
    }
  });

  it("earlyは今日から日付順に目標セッションを割り当てる", () => {
    expect(goalQuotas(allocation()).map((quota) => quota.date)).toEqual([
      "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10",
    ]);
  });

  it("free_descは空きの多い順、同点は日付昇順", () => {
    const context = createPlanningContext();
    context.tasks = context.tasks.filter((task) => task.goal_id !== null);
    context.goal_week_target_minutes.goal_toeic = 180;
    const result = buildWeeklyAllocation(context, uniformSlots([60, 180, 180, 120, 90, 80, 70]), parameters({ goal_order: "free_desc" }));
    expect(goalQuotas(result).map((quota) => quota.date)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
  });

  it("目標回数が日数を超えると先頭から2巡目を割り当てる", () => {
    const context = createPlanningContext();
    context.goal_week_target_minutes.goal_toeic = 480;
    const result = buildWeeklyAllocation(context, fixtureSlots(context), parameters());
    expect(goalQuotas(result).filter((quota) => quota.date === monday)).toHaveLength(2);
    expect(goalQuotas(result).filter((quota) => quota.date === "2026-10-06")).toHaveLength(1);
  });

  it("r>=30は軽作業版を使い、なければメインを使う", () => {
    const context = createPlanningContext();
    context.goal_week_target_minutes.goal_toeic = 350;
    expect(goalQuotas(buildWeeklyAllocation(context, fixtureSlots(context), parameters())).at(-1)).toMatchObject({ task_id: "task_toeic_vocab", minutes: 50 });
    context.tasks = context.tasks.filter((task) => task.id !== "task_toeic_vocab");
    expect(goalQuotas(buildWeeklyAllocation(context, fixtureSlots(context), parameters())).at(-1)).toMatchObject({ task_id: "task_toeic_listening", minutes: 50 });
  });

  it("r<30は最後のメインを延長する", () => {
    const context = createPlanningContext();
    context.goal_week_target_minutes.goal_toeic = 370;
    const quotas = goalQuotas(buildWeeklyAllocation(context, fixtureSlots(context), parameters()));
    expect(quotas).toHaveLength(6);
    expect(quotas.at(-1)).toMatchObject({ task_id: "task_toeic_listening", minutes: 70 });
    expect(quotas.reduce((sum, quota) => sum + quota.minutes, 0)).toBe(370);
  });

  it("目標セッションに平日・週末のbandを付ける", () => {
    const context = createPlanningContext();
    context.goal_time_bands.goal_toeic = { weekday: "evening", weekend: "daytime" };
    const quotas = goalQuotas(buildWeeklyAllocation(context, fixtureSlots(context), parameters()));
    expect(quotas.find((quota) => quota.date === "2026-10-09")?.band).toBe("evening");
    expect(quotas.find((quota) => quota.date === "2026-10-10")?.band).toBe("daytime");
  });

  it.each([[0, 0], [0.35, 60], [1, 180]])("kappa=%sで任意タスクを%s分にする", (kappa, expected) => {
    expect(taskQuotas(allocation(createPlanningContext(), { kappa }), "task_research").reduce((sum, quota) => sum + quota.minutes, 0)).toBe(expected);
  });

  it("任意quotaは1日120分以下で、必須quotaによって減った余裕を超えない", () => {
    const context = createPlanningContext();
    const required = buildWeeklyAllocation(context, fixtureSlots(context), parameters({ kappa: 0 }));
    const result = buildWeeklyAllocation(context, fixtureSlots(context), parameters({ kappa: 1 }));
    for (const day of result.days) {
      const optional = day.quotas.filter((quota) => quota.kind === "optional").reduce((sum, quota) => sum + quota.minutes, 0);
      const requiredMinutes = required.days.find((entry) => entry.date === day.date)!.quotas.reduce((sum, quota) => sum + quota.minutes, 0);
      expect(optional).toBeLessThanOrEqual(120);
      expect(optional).toBeLessThanOrEqual(Math.max(0, 240 - requiredMinutes));
    }
  });

  it("priority結果の順で任意タスクを処理する", () => {
    const context = createPlanningContext();
    const research = context.tasks.find((task) => task.id === "task_research")!;
    context.tasks.push({ ...research, id: "task_optional_high", importance: "high", remaining_minutes: 60 });
    const priorities = computeTaskPriorities(context, monday);
    const result = buildWeeklyAllocation(context, fixtureSlots(context), parameters({ kappa: 1 }), priorities);
    const sunday = result.days.find((day) => day.date === "2026-10-11")!;
    expect(sunday.quotas.filter((quota) => quota.kind === "optional").map((quota) => quota.task_id)).toEqual([
      "task_optional_high",
    ]);
    expect(taskQuotas(result, "task_research")).not.toHaveLength(0);
  });
});

describe("buildWeeklyAllocations", () => {
  it("同一quota内容を重複排除し、最大18案にする", () => {
    const empty = createPlanningContext();
    empty.tasks = [];
    empty.goals = [];
    empty.goal_week_target_minutes = {};
    empty.goal_done_minutes = {};
    empty.goal_time_bands = {};
    expect(buildWeeklyAllocations(empty, fixtureSlots(empty))).toHaveLength(1);
    const context = createPlanningContext();
    const results = buildWeeklyAllocations(context, fixtureSlots(context));
    expect(results).toHaveLength(9);
  });

  it("入力を変更せず決定論的で、正の有限分だけを今日〜日曜へ作る", () => {
    const context = createPlanningContext();
    const slots = fixtureSlots(context);
    const priorities = computeTaskPriorities(context, monday);
    const before = structuredClone({ context, slots, priorities });
    const first = buildWeeklyAllocations(context, slots, priorities);
    expect(JSON.stringify(buildWeeklyAllocations(context, slots, priorities))).toBe(JSON.stringify(first));
    expect({ context, slots, priorities }).toEqual(before);
    for (const result of first) {
      for (const day of result.days) {
        expect(day.date >= monday && day.date <= "2026-10-11").toBe(true);
        for (const quota of day.quotas) {
          expect(Number.isFinite(quota.minutes)).toBe(true);
          expect(quota.minutes).toBeGreaterThan(0);
        }
      }
    }
  });
});
