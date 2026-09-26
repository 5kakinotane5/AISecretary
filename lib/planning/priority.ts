import { addDays, toDateStr } from "@/lib/datetime";
import type { Level, PlanningContext, Task } from "@/lib/schemas";

export type TaskPriorityComponents = {
  importance: number;
  urgency: number;
  status: number;
  user: number;
};

export type TaskPriority = {
  task_id: Task["id"];
  components: TaskPriorityComponents;
  score: number;
};

/** planning.md 10.6のレベル値。 */
export function priorityLevelValue(level: Level): number {
  switch (level) {
    case "low":
      return 0.3;
    case "medium":
      return 0.6;
    case "high":
      return 1;
  }
}

/** JSTの日付だけを1日ずつ進めて数える。日時の時刻差は使わない。 */
function calendarDaysUntil(baseDate: string, targetDate: string): number {
  if (targetDate <= baseDate) return 0;
  let cursor = baseDate;
  let days = 0;
  while (cursor < targetDate) {
    cursor = addDays(cursor, 1);
    days += 1;
  }
  return days;
}

function urgencyComponent(context: PlanningContext, task: Task, baseDate: string): number {
  if (task.deadline_at !== null) {
    const days = Math.max(1, calendarDaysUntil(baseDate, toDateStr(task.deadline_at)));
    return Math.min(1, task.remaining_minutes / 60 / days);
  }

  if (task.goal_id !== null && context.goals.some((goal) => goal.id === task.goal_id)) {
    const weeklyTarget = context.goal_week_target_minutes[task.goal_id];
    const done = context.goal_done_minutes[task.goal_id];
    if (weeklyTarget === undefined || done === undefined || weeklyTarget === 0) return 0;
    const remaining = Math.max(0, weeklyTarget - done);
    return (0.6 * remaining) / weeklyTarget;
  }

  return 0;
}

function statusComponent(task: Task): number {
  switch (task.status) {
    case "in_progress":
      return 1;
    case "not_started":
      return 0.5;
    case "completed":
      throw new RangeError("PlanningContext.tasksにcompletedのタスクは含められません");
  }
}

function userComponent(context: PlanningContext, task: Task, baseDate: string): number {
  const today = toDateStr(context.now);
  if (baseDate !== today || context.checkin === null || context.checkin.date !== today) return 0;
  // wantとavoidの重複は入力スキーマで禁止されていない。設計表の記載順でwantを先に評価する。
  if (context.checkin.want_task_ids.includes(task.id)) return 1;
  if (context.checkin.avoid_task_ids.includes(task.id)) return -1;
  return 0;
}

/** 個別タスクの4成分と優先度W_iを、指定したJST基準日について計算する。 */
export function computeTaskPriority(
  context: PlanningContext,
  task: Task,
  baseDate: string,
): TaskPriority {
  const components: TaskPriorityComponents = {
    importance: priorityLevelValue(task.importance),
    urgency: urgencyComponent(context, task, baseDate),
    status: statusComponent(task),
    user: userComponent(context, task, baseDate),
  };
  const score =
    0.35 * components.importance +
    0.35 * components.urgency +
    0.1 * components.status +
    0.2 * components.user;
  return { task_id: task.id, components, score };
}

/** context内の全タスクをscore降順、同点ならtask.id昇順で返す。 */
export function computeTaskPriorities(
  context: PlanningContext,
  baseDate: string,
): TaskPriority[] {
  return context.tasks
    .map((task) => computeTaskPriority(context, task, baseDate))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.task_id < right.task_id ? -1 : left.task_id > right.task_id ? 1 : 0;
    });
}
