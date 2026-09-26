import { addDays, diffMinutesExact, getWeekdayJa, toDateStr } from "@/lib/datetime";
import type { PlanningContext, Task, TimeBand } from "@/lib/schemas";
import { CONFIG } from "./config";
import { classifyTask, isHighConcentrationTask } from "./fit";
import { computeTaskPriorities, type TaskPriority } from "./priority";
import type { FreeSlot } from "./slots";

export type GoalOrder = (typeof CONFIG.allocationGrid.goalOrder)[number];
export type AllocationParameters = { rho: number; kappa: number; goal_order: GoalOrder };
export type QuotaKind = "deadline" | "goal" | "optional";
export type CarryoverRule = "deadline_before_due" | "goal_next_day" | null;

export type AllocationQuota = {
  kind: QuotaKind;
  task_id: Task["id"];
  minutes: number;
  required: boolean;
  band: TimeBand | null;
  carryover: CarryoverRule;
  deadline_at: Task["deadline_at"];
  completion_target_date: string | null;
};

export type DailyQuota = { date: string; quotas: AllocationQuota[] };
export type WeeklyAllocation = { parameters: AllocationParameters; days: DailyQuota[] };

function ceilTo15(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}

function floorTo15(minutes: number): number {
  return Math.floor(minutes / 15) * 15;
}

function calendarDays(from: string, to: string): number {
  if (to <= from) return 0;
  let cursor = from;
  let days = 0;
  while (cursor < to) {
    cursor = addDays(cursor, 1);
    days += 1;
  }
  return days;
}

function quota(kind: QuotaKind, task: Task, minutes: number, options: Partial<AllocationQuota> = {}): AllocationQuota {
  return {
    kind,
    task_id: task.id,
    minutes,
    required: kind !== "optional",
    band: null,
    carryover: kind === "deadline" ? "deadline_before_due" : kind === "goal" ? "goal_next_day" : null,
    deadline_at: task.deadline_at,
    completion_target_date: null,
    ...options,
  };
}

function addQuota(days: DailyQuota[], date: string, value: AllocationQuota): void {
  if (value.minutes <= 0) return;
  days.find((day) => day.date === date)?.quotas.push(value);
}

function allocateDeadlines(context: PlanningContext, days: DailyQuota[], rho: number): void {
  const today = toDateStr(context.now);
  const sunday = days.at(-1)!.date;
  const tasks = context.tasks
    .filter((task) => classifyTask(task) === "deadline")
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const task of tasks) {
    const deadline = toDateStr(task.deadline_at!);
    const n = calendarDays(today, deadline);
    const targetOffset = Math.min(Math.max(0, Math.round(rho * n)), Math.max(0, n - 1));
    const target = addDays(today, targetOffset);
    const effectiveEnd = target < sunday ? target : sunday;
    const dayCount = calendarDays(today, effectiveEnd) + 1;
    const amount = target <= sunday
      ? task.remaining_minutes
      : Math.min(task.remaining_minutes, ceilTo15(task.remaining_minutes * days.length / (targetOffset + 1)));
    if (amount <= 0 || dayCount <= 0) continue;

    let perSession = ceilTo15(amount / dayCount);
    if (isHighConcentrationTask(task)) perSession = Math.min(120, Math.max(60, perSession));
    let count = Math.ceil(amount / perSession);
    if (count > dayCount) {
      count = dayCount;
      perSession = ceilTo15(amount / dayCount);
    }
    for (let index = 0; index < count; index++) {
      const position = count === 1 ? dayCount - 1 : Math.round(index * (dayCount - 1) / (count - 1));
      const minutes = index === count - 1 ? amount - perSession * (count - 1) : perSession;
      addQuota(days, addDays(today, position), quota("deadline", task, minutes, {
        completion_target_date: target,
      }));
    }
  }
}

function freeMinutesByDate(days: DailyQuota[], slots: readonly FreeSlot[]): Map<string, number> {
  return new Map(days.map((day) => [day.date, slots
    .filter((slot) => toDateStr(slot.start) === day.date)
    .reduce((sum, slot) => sum + Math.max(0, diffMinutesExact(slot.start, slot.work_end)), 0)]));
}

function orderedGoalDates(days: DailyQuota[], slots: readonly FreeSlot[], order: GoalOrder): string[] {
  if (order === "early") return days.map((day) => day.date);
  const free = freeMinutesByDate(days, slots);
  return days.map((day) => day.date).sort((a, b) => (free.get(b)! - free.get(a)!) || a.localeCompare(b));
}

function goalBand(context: PlanningContext, goalId: string, date: string): TimeBand | null {
  const bands = context.goal_time_bands[goalId];
  if (!bands) return null;
  const weekday = getWeekdayJa(date);
  return weekday === "土" || weekday === "日" ? bands.weekend : bands.weekday;
}

function goalTasks(context: PlanningContext, goalId: string): { main: Task; light: Task | null } | null {
  const tasks = context.tasks.filter((task) => task.goal_id === goalId && task.deadline_at === null);
  if (tasks.length === 0) return null;
  const main = [...tasks].sort((a, b) => b.estimated_minutes - a.estimated_minutes || a.id.localeCompare(b.id))[0];
  const light = [...tasks]
    .filter((task) => task.id !== main.id)
    .sort((a, b) => a.estimated_minutes - b.estimated_minutes || a.id.localeCompare(b.id))[0] ?? null;
  return { main, light };
}

function allocateGoals(context: PlanningContext, days: DailyQuota[], slots: readonly FreeSlot[], order: GoalOrder): void {
  const dates = orderedGoalDates(days, slots, order);
  for (const goal of [...context.goals].sort((a, b) => a.id.localeCompare(b.id))) {
    const pair = goalTasks(context, goal.id);
    if (!pair || dates.length === 0 || pair.main.estimated_minutes <= 0) continue;
    const target = context.goal_week_target_minutes[goal.id] ?? 0;
    const done = context.goal_done_minutes[goal.id] ?? 0;
    const remaining = Math.max(0, target - done);
    const count = Math.floor(remaining / pair.main.estimated_minutes);
    const remainder = remaining - count * pair.main.estimated_minutes;
    const assigned: { date: string; quota: AllocationQuota }[] = [];
    const counts = new Map(dates.map((date) => [date, 0]));

    for (let index = 0; index < count; index++) {
      const date = dates[index % dates.length];
      const value = quota("goal", pair.main, pair.main.estimated_minutes, { band: goalBand(context, goal.id, date) });
      addQuota(days, date, value);
      assigned.push({ date, quota: value });
      counts.set(date, counts.get(date)! + 1);
    }
    if (remainder >= 30) {
      const minimum = Math.min(...counts.values());
      const date = dates.find((candidate) => counts.get(candidate) === minimum)!;
      const task = pair.light ?? pair.main;
      addQuota(days, date, quota("goal", task, remainder, { band: goalBand(context, goal.id, date) }));
    } else if (remainder > 0 && assigned.length > 0) {
      assigned.at(-1)!.quota.minutes += remainder;
    } else if (remainder > 0) {
      const date = dates[0];
      addQuota(days, date, quota("goal", pair.main, remainder, { band: goalBand(context, goal.id, date) }));
    }
  }
}

function allocateOptional(
  context: PlanningContext,
  days: DailyQuota[],
  kappa: number,
  priorities: readonly TaskPriority[],
): void {
  if (kappa === 0) return;
  const priorityIndex = new Map(priorities.map((entry, index) => [entry.task_id, index]));
  const tasks = context.tasks.filter((task) => classifyTask(task) === "optional").sort((a, b) =>
    (priorityIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (priorityIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      || a.id.localeCompare(b.id));
  const used = new Map(days.map((day) => [day.date, day.quotas.reduce((sum, item) => sum + (item.required ? item.minutes : 0), 0)]));
  const optionalUsed = new Map(days.map((day) => [day.date, 0]));

  for (const task of tasks) {
    let remaining = floorTo15(kappa * task.remaining_minutes);
    const usedForTask = new Set<string>();
    while (remaining > 0) {
      const candidates = days
        .filter((day) => !usedForTask.has(day.date))
        .map((day) => ({
          day,
          room: Math.max(0, Math.min(
            CONFIG.comfortableTaskMinutes - used.get(day.date)!,
            CONFIG.optionalMaxPerDay - optionalUsed.get(day.date)!,
          )),
        }))
        .filter(({ room }) => room > 0)
        .sort((a, b) => b.room - a.room || b.day.date.localeCompare(a.day.date));
      if (candidates.length === 0) break;
      const selected = candidates[0];
      const minutes = Math.min(remaining, selected.room, CONFIG.optionalMaxPerDay);
      addQuota(days, selected.day.date, quota("optional", task, minutes));
      used.set(selected.day.date, used.get(selected.day.date)! + minutes);
      optionalUsed.set(selected.day.date, optionalUsed.get(selected.day.date)! + minutes);
      usedForTask.add(selected.day.date);
      remaining -= minutes;
    }
  }
}

function canonicalQuotaKey(allocation: WeeklyAllocation): string {
  return allocation.days.map((day) => `${day.date}:${day.quotas
    .map((item) => [item.kind, item.task_id, item.minutes, item.required ? 1 : 0, item.band ?? "", item.carryover ?? "", item.deadline_at ?? ""].join("|"))
    .sort()
    .join(";")}`).join("/");
}

/** P3のパラメータ1組について、今日から日曜までの日別クォータを作る。 */
export function buildWeeklyAllocation(
  context: PlanningContext,
  slots: readonly FreeSlot[],
  parameters: AllocationParameters,
  priorities: readonly TaskPriority[] = computeTaskPriorities(context, toDateStr(context.now)),
): WeeklyAllocation {
  const today = toDateStr(context.now);
  const sunday = addDays(context.week_start, 6);
  const days: DailyQuota[] = [];
  for (let date = today; date <= sunday; date = addDays(date, 1)) days.push({ date, quotas: [] });
  allocateDeadlines(context, days, parameters.rho);
  allocateGoals(context, days, slots, parameters.goal_order);
  allocateOptional(context, days, parameters.kappa, priorities);
  return { parameters: { ...parameters }, days };
}

/** P3.1の最大18組を生成し、クォータが同じ案を決定論的に除重する。 */
export function buildWeeklyAllocations(
  context: PlanningContext,
  slots: readonly FreeSlot[],
  priorities: readonly TaskPriority[] = computeTaskPriorities(context, toDateStr(context.now)),
): WeeklyAllocation[] {
  const unique = new Map<string, WeeklyAllocation>();
  for (const rho of CONFIG.allocationGrid.rho) {
    for (const kappa of CONFIG.allocationGrid.kappa) {
      for (const goal_order of CONFIG.allocationGrid.goalOrder) {
        const allocation = buildWeeklyAllocation(context, slots, { rho, kappa, goal_order }, priorities);
        const key = canonicalQuotaKey(allocation);
        if (!unique.has(key)) unique.set(key, allocation);
      }
    }
  }
  return [...unique.values()];
}
