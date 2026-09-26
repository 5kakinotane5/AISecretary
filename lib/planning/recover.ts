import { addDays, diffMinutesExact, formatMonthDay, getWeekdayJa, toDateStr } from "@/lib/datetime";
import type { Infeasible, PlanningContext } from "@/lib/schemas";
import type { WeekBuildResult } from "./day-beam";
import type { FreeSlot } from "./slots";

function dailyCapacity(context: PlanningContext, slots: readonly FreeSlot[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const slot of slots) result.set(toDateStr(slot.start), (result.get(toDateStr(slot.start)) ?? 0) + Math.max(0, diffMinutesExact(slot.start, slot.work_end)));
  for (const [date, minutes] of result) result.set(date, Math.min(minutes, context.preferences.daily_work_limit_minutes));
  return result;
}

function adjustmentDay(capacity: ReadonlyMap<string, number>): string | null {
  const date = [...capacity].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  return date ? `${getWeekdayJa(date)}曜の予定を調整する` : null;
}

/** 探索前でも証明できる容量不足。過大なquota列挙を避ける上限判定でもある。 */
export function detectCapacityShortage(context: PlanningContext, slots: readonly FreeSlot[]): Infeasible | null {
  const capacity = dailyCapacity(context, slots);
  const today = toDateStr(context.now);
  const sunday = addDays(context.week_start, 6);
  for (const task of [...context.tasks].filter((entry) => entry.deadline_at && toDateStr(entry.deadline_at) <= sunday).sort((a, b) => a.id.localeCompare(b.id))) {
    const deadline = toDateStr(task.deadline_at!);
    const last = deadline === today ? today : addDays(deadline, -1);
    const available = [...capacity].filter(([date]) => date >= today && date <= last).reduce((sum, entry) => sum + entry[1], 0);
    if (task.remaining_minutes > available) {
      const changeDay = adjustmentDay(capacity);
      return { feasible: false, reason: `${task.title}を締切（${formatMonthDay(task.deadline_at!)}）までに終えるには、空き時間が${task.remaining_minutes - available}分足りません。`, required_changes: [`${task.title}の所要時間を見直す`, ...(changeDay ? [changeDay] : [])].slice(0, 3) };
    }
  }
  const weeklyCapacity = [...capacity.values()].reduce((sum, value) => sum + value, 0);
  for (const goal of [...context.goals].sort((a, b) => a.id.localeCompare(b.id))) {
    const remaining = Math.max(0, (context.goal_week_target_minutes[goal.id] ?? 0) - (context.goal_done_minutes[goal.id] ?? 0));
    if (remaining > weeklyCapacity) {
      const changeDay = adjustmentDay(capacity);
      return { feasible: false, reason: `今週の${goal.task_name}の${remaining - weeklyCapacity}分を置く空き時間が足りません。`, required_changes: [...(changeDay ? [changeDay] : []), "目標の時間を見直す（設定の『新しい目的地を相談する』から）"].slice(0, 3) };
    }
  }
  return null;
}

export function explainFailures(context: PlanningContext, failures: readonly WeekBuildResult[]): Infeasible {
  const failed = failures.filter((entry): entry is Extract<WeekBuildResult, { ok: false }> => !entry.ok).sort((a, b) => a.remaining.reduce((s, q) => s + (q.quota.required ? q.remaining_minutes : 0), 0) - b.remaining.reduce((s, q) => s + (q.quota.required ? q.remaining_minutes : 0), 0) || a.reason.localeCompare(b.reason))[0];
  const remaining = failed?.remaining.filter((entry) => entry.quota.required && entry.remaining_minutes > 0).sort((a, b) => b.remaining_minutes - a.remaining_minutes || a.quota.task_id.localeCompare(b.quota.task_id))[0];
  const task = remaining ? context.tasks.find((entry) => entry.id === remaining.quota.task_id) : null;
  const goal = task?.goal_id ? context.goals.find((entry) => entry.id === task.goal_id) : null;
  const shortage = Math.max(1, remaining?.remaining_minutes ?? 1);
  const reason = task?.deadline_at ? `${task.title}を締切（${formatMonthDay(task.deadline_at)}）までに終えるには、空き時間が${shortage}分足りません。` : `今週の${goal?.task_name ?? "目標"}の${shortage}分を置く空き時間が足りません。`;
  const changes = [task ? `${task.title}の所要時間を見直す` : null, failed ? `${failed.date}の予定を調整する` : null, goal ? "目標の時間を見直す（設定の『新しい目的地を相談する』から）" : null].filter((value): value is string => value !== null).slice(0, 3);
  return { feasible: false, reason, required_changes: changes.length ? changes : ["予定を調整する"] };
}
