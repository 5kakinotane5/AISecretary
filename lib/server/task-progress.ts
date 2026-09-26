import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task } from "@/lib/schemas";
import { addDays, diffMinutes, getWeekStart, toDateStr } from "@/lib/datetime";
import { getActiveGoalRecord, type ActiveGoalRecord } from "./repositories/goals";
import { listTasks } from "./repositories/tasks";
import { listTaskDoneLogs, type TaskDoneLog } from "./repositories/task-done-logs";
import { listElapsedActivePlanTaskItems, type ElapsedTaskItem } from "./repositories/plans";

// タスクの残り時間と、目標の今週の目標分・実施済み（backend.md 8.2・8.3）。
// GET /api/tasks と PlanningContext の組み立て（planning-context.ts）で使う
export type TaskProgress = {
  tasks: Task[];                                    // completed を除く。remaining_minutes は計算した値
  goal_week_target_minutes: Record<string, number>; // goal_id → 今週の目標分 W
  goal_done_minutes: Record<string, number>;        // goal_id → 今週の実施済み D
};

const round15 = (minutes: number) => Math.round(minutes / 15) * 15;

// 今週の目標分 W（backend.md 8.2）。
// 目標を今週作った場合の残り日数は、作った日（created_at の日付、JST）から日曜まで
export function goalWeekTargetMinutes(record: ActiveGoalRecord, weekStart: string): number {
  const full = (record.goal.target_hours_per_week ?? 0) * 60;
  const createdDate = toDateStr(record.created_at);
  if (createdDate < weekStart) return full;
  const sunday = addDays(weekStart, 6);
  let remainingDays = 0;
  for (let d = createdDate; d <= sunday; d = addDays(d, 1)) remainingDays++;
  return round15((full * remainingDays) / 7);
}

// 読み込んだ値から残り時間を計算する（DB に触れない）
export function computeTaskProgress(input: {
  tasks: Task[];               // completed を含む全件（remaining_minutes は DB の値）
  goal: ActiveGoalRecord | null;
  doneLogs: TaskDoneLog[];
  elapsedItems: ElapsedTaskItem[];
  now: string;
}): TaskProgress {
  const { tasks, goal, doneLogs, elapsedItems, now } = input;
  const weekStart = getWeekStart(toDateStr(now));
  const itemMinutes = (item: ElapsedTaskItem) => diffMinutes(item.start_at, item.end_at);

  // 締切・任意・軽作業の実施済み：task_done_logs の全期間 ＋ 経過した計画の項目
  const doneByTask = new Map<string, number>();
  const add = (taskId: string, minutes: number) => doneByTask.set(taskId, (doneByTask.get(taskId) ?? 0) + minutes);
  for (const log of doneLogs) add(log.task_id, log.minutes);
  for (const item of elapsedItems) add(item.task_id, itemMinutes(item));

  // 目標の W と D。D は今週の分だけ（task_done_logs も計画の項目も date ≥ week_start）
  const goalWeekTarget: Record<string, number> = {};
  const goalDone: Record<string, number> = {};
  if (goal) {
    const goalId = goal.goal.id;
    const goalTaskIds = new Set(tasks.filter((t) => t.goal_id === goalId).map((t) => t.id));
    goalWeekTarget[goalId] = goalWeekTargetMinutes(goal, weekStart);
    goalDone[goalId] =
      doneLogs
        .filter((l) => goalTaskIds.has(l.task_id) && l.date >= weekStart)
        .reduce((sum, l) => sum + l.minutes, 0) +
      elapsedItems
        .filter((i) => goalTaskIds.has(i.task_id) && i.date >= weekStart)
        .reduce((sum, i) => sum + itemMinutes(i), 0);
  }

  return {
    tasks: tasks
      .filter((t) => t.status !== "completed")
      .map((t) => {
        // 目標タスク：R = max(0, W − D)。同じ目標のタスクで共有
        if (t.goal_id !== null && t.goal_id in goalWeekTarget) {
          return { ...t, remaining_minutes: Math.max(0, goalWeekTarget[t.goal_id] - goalDone[t.goal_id]) };
        }
        // それ以外（有効な目標が見つからない目標タスクも含む）：DB の値 − 実施済み
        return { ...t, remaining_minutes: Math.max(0, t.remaining_minutes - (doneByTask.get(t.id) ?? 0)) };
      }),
    goal_week_target_minutes: goalWeekTarget,
    goal_done_minutes: goalDone,
  };
}

// DB から読んで計算する。now は getNow() の値
export async function loadTaskProgress(supabase: SupabaseClient, now: string): Promise<TaskProgress> {
  const [tasks, goal, doneLogs, elapsedItems] = await Promise.all([
    listTasks(supabase),
    getActiveGoalRecord(supabase),
    listTaskDoneLogs(supabase),
    listElapsedActivePlanTaskItems(supabase, now),
  ]);
  return computeTaskProgress({ tasks, goal, doneLogs, elapsedItems, now });
}
