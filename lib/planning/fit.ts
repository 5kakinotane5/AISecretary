import { addDays, addMinutes, atJstTime, diffMinutesExact, toDateStr } from "@/lib/datetime";
import type { PlanningContext, Task, TimeBand } from "@/lib/schemas";
import { CONFIG } from "./config";
import type { FreeSlot } from "./slots";

export type TaskKind = "deadline" | "goal" | "optional" | "light";

export type TaskFitInput = {
  context: PlanningContext;
  task: Task;
  slot: FreeSlot;
  start: string;
  minutes: number;
  /** 目標セッションに付いた、その日の希望時間帯。 */
  band: TimeBand | null;
};

export type TaskFitResult = {
  duration_fit: number;
  time_of_day_fit: number;
  concentration_fit: number;
  fatigue_fit: number;
  interrupt_fit: number;
  split_fit: number;
  q: number;
  gate: 0 | 1;
  fit: number;
};

/** common.md 1.5。分類順により、同じタスクを複数種類へ入れない。 */
export function classifyTask(task: Task): TaskKind {
  if (task.deadline_at !== null) return "deadline";
  if (task.goal_id !== null) return "goal";
  if (task.buffer_fit === "high" && task.estimated_minutes <= 30) return "light";
  return "optional";
}

/** common.md 1.5の高集中タスク判定。 */
export function isHighConcentrationTask(task: Task): boolean {
  return task.concentration === "high" || (classifyTask(task) === "goal" && task.concentration === "medium");
}

function isSameOrAfter(left: string, right: string): boolean {
  return diffMinutesExact(right, left) >= 0;
}

function isSameOrBefore(left: string, right: string): boolean {
  return diffMinutesExact(left, right) >= 0;
}

function bandBounds(date: string, band: TimeBand, slot: FreeSlot): [string, string] {
  switch (band) {
    case "morning":
      return [atJstTime(date, "06:00"), atJstTime(date, "12:00")];
    case "daytime":
      return [atJstTime(date, "12:00"), atJstTime(date, "18:00")];
    case "evening":
      return [atJstTime(date, "18:00"), slot.work_end];
  }
}

function isDeadlineLastDay(context: PlanningContext, task: Task, date: string): boolean {
  if (task.deadline_at === null) return false;
  const today = toDateStr(context.now);
  const deadline = toDateStr(task.deadline_at);
  const lastDay = deadline === today ? today : addDays(deadline, -1);
  return date === lastDay;
}

function timeOfDayFit(input: TaskFitInput, end: string): number {
  const { task, slot, start, band } = input;
  if (!isSameOrAfter(start, slot.start) || !isSameOrBefore(end, slot.work_end)) return 0;

  const date = toDateStr(start);
  if (classifyTask(task) === "goal" && band !== null) {
    const [bandStart, bandEnd] = bandBounds(date, band, slot);
    if (!isSameOrAfter(start, bandStart) || !isSameOrBefore(end, bandEnd)) return 0;
  }

  if (!isHighConcentrationTask(task)) return 1;
  const morning = atJstTime(date, "07:30");
  const late = atJstTime(date, "22:00");
  const cutoff = atJstTime(date, "23:00");
  if (!isSameOrAfter(start, morning)) return 0;
  if (!isSameOrAfter(start, late)) return 1;
  if (!isSameOrAfter(start, cutoff)) return 0.5;
  return 0;
}

function stateFits(context: PlanningContext, task: Task, date: string): [number, number] {
  const today = toDateStr(context.now);
  if (date !== today || context.checkin === null || context.checkin.date !== today) return [1, 1];

  const high = isHighConcentrationTask(task);
  let concentration = 1;
  if (context.checkin.concentration === "low") {
    concentration = high ? 0 : task.concentration === "medium" ? 0.5 : 1;
  }

  let fatigue = 1;
  if (context.checkin.fatigue === "high") {
    fatigue = high ? 0 : task.concentration === "medium" ? 0.5 : 1;
  } else if (context.checkin.fatigue === "medium" && high) {
    fatigue = 0.6;
  }

  if (isDeadlineLastDay(context, task, date)) {
    if (concentration === 0) concentration = CONFIG.lastDayFitFloor;
    if (fatigue === 0) fatigue = CONFIG.lastDayFitFloor;
  }
  return [concentration, fatigue];
}

/** planning.md P4: タスクを1つの空きへ置く場合の特徴量・q・ゲート・Fitを返す。 */
export function computeTaskFit(input: TaskFitInput): TaskFitResult {
  const { context, task, slot, start, minutes } = input;
  const end = addMinutes(start, minutes);
  const duration = !task.splittable
    ? Number(minutes === task.estimated_minutes)
    : Number(minutes >= 30);
  const timeOfDay = timeOfDayFit(input, end);
  const [concentration, fatigue] = stateFits(context, task, toDateStr(start));
  const available = diffMinutesExact(start, slot.work_end);
  const interrupt = task.interruptible ? 1 : available >= minutes + 30 ? 1 : 0.5;
  const split = task.splittable ? 1 : duration;
  const features = [duration, timeOfDay, concentration, fatigue, interrupt, split] as const;
  const q = features.reduce((sum, value, index) => sum + value * CONFIG.fitWeights[index], 0);
  const gate = (duration === 0 || timeOfDay === 0 || concentration === 0 || fatigue === 0 ? 0 : 1) as 0 | 1;
  return {
    duration_fit: duration,
    time_of_day_fit: timeOfDay,
    concentration_fit: concentration,
    fatigue_fit: fatigue,
    interrupt_fit: interrupt,
    split_fit: split,
    q,
    gate,
    fit: gate * q,
  };
}
