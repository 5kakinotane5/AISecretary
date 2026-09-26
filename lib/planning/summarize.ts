import { diffMinutesExact } from "@/lib/datetime";
import {
  PlanSummarySchema,
  type DayPlan,
  type PlanningContext,
  type PlanSummary,
  type ScheduleItem,
} from "@/lib/schemas";

function minutes(item: ScheduleItem): number {
  return diffMinutesExact(item.start_at, item.end_at);
}

function sumKind(items: readonly ScheduleItem[], kind: ScheduleItem["kind"]): number {
  return items
    .filter((item) => item.kind === kind)
    .reduce((total, item) => total + minutes(item), 0);
}

/** planning.md 10.12: 7日分の項目からPlanSummaryを計算する。 */
export function summarizePlan(
  context: PlanningContext,
  days: readonly DayPlan[],
  explanation: string,
): PlanSummary {
  const allItems = days.flatMap((day) => day.items);
  const goalIds = new Set(context.goals.map((goal) => goal.id));
  const goalTaskIds = new Set(
    context.tasks.filter((task) => task.goal_id !== null && goalIds.has(task.goal_id)).map((task) => task.id),
  );
  const deadlineTaskIds = new Set(
    context.tasks.filter((task) => task.deadline_at !== null).map((task) => task.id),
  );

  const goalMinutes = allItems
    .filter(
      (item) => item.kind === "task" && item.task_id !== null && goalTaskIds.has(item.task_id),
    )
    .reduce((total, item) => total + minutes(item), 0);

  const deadlineTaskCount = new Set(
    allItems
      .filter(
        (item) =>
          item.kind === "task" && item.task_id !== null && deadlineTaskIds.has(item.task_id),
      )
      .map((item) => item.task_id),
  ).size;

  const overloadThreshold = context.preferences.daily_work_limit_minutes * 0.8;
  const overload = days.some(
    (day) => sumKind(day.items, "task") > overloadThreshold,
  );

  return PlanSummarySchema.parse({
    task_hours: sumKind(allItems, "task") / 60,
    buffer_hours: sumKind(allItems, "buffer") / 60,
    free_hours: sumKind(allItems, "free") / 60,
    travel_hours: sumKind(allItems, "travel") / 60,
    goal_hours: goalMinutes / 60,
    deadline_task_count: deadlineTaskCount,
    overload,
    explanation,
  });
}
