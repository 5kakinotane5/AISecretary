import { PlanSummarySchema, type DayPlan, type PlanSummary } from "@/lib/schemas";
import { diffMinutes } from "@/lib/datetime";
import { TASKS } from "@/mocks/tasks";
import { GOAL } from "@/mocks/goal";
import { USER_PREFERENCE } from "@/mocks/persona";

const GOAL_TASK_IDS = new Set(TASKS.filter((t) => t.goal_id === GOAL.id).map((t) => t.id));
const DEADLINE_TASK_IDS = new Set(TASKS.filter((t) => t.deadline_at !== null).map((t) => t.id));

function minutesOfKind(days: DayPlan[], kind: string): number {
  return days
    .flatMap((d) => d.items)
    .filter((i) => i.kind === kind)
    .reduce((sum, i) => sum + diffMinutes(i.start_at, i.end_at), 0);
}

/** 5.9章のとおり、summary の数値は手で書かず items から計算する */
export function summarizePlan(days: DayPlan[], explanation: string): PlanSummary {
  const goalMinutes = days
    .flatMap((d) => d.items)
    .filter((i) => i.kind === "task" && i.task_id !== null && GOAL_TASK_IDS.has(i.task_id))
    .reduce((sum, i) => sum + diffMinutes(i.start_at, i.end_at), 0);

  const deadlineTaskCount = new Set(
    days
      .flatMap((d) => d.items)
      .filter((i) => i.kind === "task" && i.task_id !== null && DEADLINE_TASK_IDS.has(i.task_id))
      .map((i) => i.task_id),
  ).size;

  const overload = days.some(
    (d) =>
      d.items.filter((i) => i.kind === "task").reduce((sum, i) => sum + diffMinutes(i.start_at, i.end_at), 0) >
      USER_PREFERENCE.daily_work_limit_minutes,
  );

  return PlanSummarySchema.parse({
    task_hours: minutesOfKind(days, "task") / 60,
    buffer_hours: minutesOfKind(days, "buffer") / 60,
    free_hours: minutesOfKind(days, "free") / 60,
    travel_hours: minutesOfKind(days, "travel") / 60,
    goal_hours: goalMinutes / 60,
    deadline_task_count: deadlineTaskCount,
    overload,
    explanation,
  });
}
