import { addDays, diffMinutesExact, toDateStr } from "@/lib/datetime";
import { ObjectiveVectorSchema, type DayPlan, type ObjectiveVector, type PlanningContext } from "@/lib/schemas";
import { CONFIG } from "./config";
import type { DayBeamResult } from "./day-beam";
import { classifyTask } from "./fit";
import { computeTaskPriorities, type TaskPriority } from "./priority";
import type { FreeSlot } from "./slots";

export type ObjectiveOptions = {
  slots?: readonly FreeSlot[];
  dayResults?: readonly DayBeamResult[];
  priorities?: readonly TaskPriority[];
};

const clip = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

function activeMinutes(start: string, end: string, now: string): number {
  if (end <= now) return 0;
  return Math.max(0, diffMinutesExact(start < now ? now : start, end));
}

/** planning.md P6の7次元目的ベクトル。 */
export function evaluateObjectives(context: PlanningContext, days: readonly DayPlan[], options: ObjectiveOptions = {}): ObjectiveVector {
  const today = toDateStr(context.now);
  const sunday = addDays(context.week_start, 6);
  const priorities = new Map((options.priorities ?? computeTaskPriorities(context, today)).map((entry) => [entry.task_id, entry.score]));
  const items = days.flatMap((day) => day.items).filter((item) => item.end_at > context.now);
  const placed = new Map<string, number>();
  for (const item of items) if (item.kind === "task" && item.task_id) placed.set(item.task_id, (placed.get(item.task_id) ?? 0) + activeMinutes(item.start_at, item.end_at, context.now));

  const achievementTasks = context.tasks.filter((task) => { const kind = classifyTask(task); return kind === "deadline" || kind === "optional"; });
  const achDen = achievementTasks.reduce((sum, task) => sum + (priorities.get(task.id) ?? 0) * task.remaining_minutes, 0);
  const achNum = achievementTasks.reduce((sum, task) => sum + (priorities.get(task.id) ?? 0) * Math.min(task.remaining_minutes, placed.get(task.id) ?? 0), 0);
  const achievement = achDen === 0 ? 1 : clip(achNum / achDen);

  const deadlineTasks = context.tasks.filter((task) => task.deadline_at !== null);
  const deadlineSafety = deadlineTasks.length === 0 ? 1 : deadlineTasks.reduce((sum, task) => {
    const deadlineDate = toDateStr(task.deadline_at!);
    if (deadlineDate > sunday) return sum + 1;
    const amount = task.remaining_minutes;
    const done = placed.get(task.id) ?? 0;
    const coverage = amount <= 0 ? 1 : Math.min(1, done / amount);
    const ends = items.filter((item) => item.kind === "task" && item.task_id === task.id).map((item) => item.end_at).sort();
    const last = ends.at(-1);
    const totalWindow = diffMinutesExact(context.now, task.deadline_at!);
    const slack = coverage === 1 && last && totalWindow > 0 ? clip(diffMinutesExact(last, task.deadline_at!) / totalWindow) : 0;
    return sum + 0.5 * coverage + 0.5 * slack;
  }, 0) / deadlineTasks.length;

  const taskMinutes = items.filter((item) => item.kind === "task").reduce((sum, item) => sum + activeMinutes(item.start_at, item.end_at, context.now), 0);
  const bufferMinutes = items.filter((item) => item.kind === "buffer").reduce((sum, item) => sum + activeMinutes(item.start_at, item.end_at, context.now), 0);
  const freeMinutes = items.filter((item) => item.kind === "free").reduce((sum, item) => sum + activeMinutes(item.start_at, item.end_at, context.now), 0);
  const fitMinutes = options.dayResults?.reduce((sum, result) => sum + result.items.filter((item) => item.kind === "task").reduce((day, item) => day + diffMinutesExact(item.start_at, item.end_at), 0), 0) ?? 0;
  const fitWeighted = options.dayResults?.reduce((sum, result) => {
    const minutes = result.items.filter((item) => item.kind === "task").reduce((day, item) => day + diffMinutesExact(item.start_at, item.end_at), 0);
    return sum + result.evaluation.fit * minutes;
  }, 0) ?? 0;
  const taskFit = taskMinutes === 0 ? 1 : fitMinutes > 0 ? clip(fitWeighted / fitMinutes) : 1;
  const buffer = taskMinutes === 0 ? 1 : clip(bufferMinutes / (0.5 * taskMinutes));
  const slotMinutes = options.slots?.reduce((sum, slot) => sum + activeMinutes(slot.start, slot.end, context.now), 0) ?? 0;
  const freeTime = slotMinutes === 0 ? 1 : clip(freeMinutes / slotMinutes);

  const dates: string[] = [];
  for (let date = today; date <= sunday; date = addDays(date, 1)) dates.push(date);
  const taskByDay = new Map(dates.map((date) => [date, days.find((day) => day.date === date)?.items.filter((item) => item.kind === "task" && item.end_at > context.now).reduce((sum, item) => sum + activeMinutes(item.start_at, item.end_at, context.now), 0) ?? 0]));
  const comfortableDays = dates.filter((date) => taskByDay.get(date)! <= CONFIG.comfortableTaskMinutes).length;
  const longFreeDays = dates.filter((date) => days.find((day) => day.date === date)?.items.some((item) => item.kind === "free" && activeMinutes(item.start_at, item.end_at, context.now) >= 60)).length;
  const control = dates.length === 0 ? 1 : 0.5 * comfortableDays / dates.length + 0.5 * longFreeDays / dates.length;
  const maxOver = context.preferences.daily_work_limit_minutes - CONFIG.comfortableTaskMinutes;
  const overload = dates.reduce((sum, date) => sum + Math.max(0, taskByDay.get(date)! - CONFIG.comfortableTaskMinutes) ** 2, 0);
  const recovery = maxOver <= 0 || dates.length === 0 ? Number(overload === 0) : 1 - Math.min(1, overload / (dates.length * maxOver ** 2));
  return ObjectiveVectorSchema.parse({ achievement: clip(achievement), deadline_safety: clip(deadlineSafety), task_fit: clip(taskFit), buffer: clip(buffer), free_time: clip(freeTime), control: clip(control), recovery: clip(recovery) });
}
