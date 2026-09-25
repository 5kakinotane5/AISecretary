import { PlanSummarySchema, type DayPlan, type PlanSummary } from "@/lib/schemas";
import { diffMinutes } from "@/lib/datetime";
import { sumMinutesOfKind } from "@/lib/schedule";
import { TASKS } from "@/mocks/tasks";
import { GOAL } from "@/mocks/goal";
import { USER_PREFERENCE } from "@/mocks/persona";

const GOAL_TASK_IDS = new Set(TASKS.filter((t) => t.goal_id === GOAL.id).map((t) => t.id));
const DEADLINE_TASK_IDS = new Set(TASKS.filter((t) => t.deadline_at !== null).map((t) => t.id));

/** 5.9章のとおり、summary の数値は手で書かず items から計算する */
export function summarizePlan(days: DayPlan[], explanation: string): PlanSummary {
  const allItems = days.flatMap((d) => d.items);

  const goalMinutes = allItems
    .filter((i) => i.kind === "task" && i.task_id !== null && GOAL_TASK_IDS.has(i.task_id))
    .reduce((sum, i) => sum + diffMinutes(i.start_at, i.end_at), 0);

  const deadlineTaskCount = new Set(
    allItems
      .filter((i) => i.kind === "task" && i.task_id !== null && DEADLINE_TASK_IDS.has(i.task_id))
      .map((i) => i.task_id),
  ).size;

  const overload = days.some((d) => sumMinutesOfKind(d.items, "task") > USER_PREFERENCE.daily_work_limit_minutes);

  return PlanSummarySchema.parse({
    task_hours: sumMinutesOfKind(allItems, "task") / 60,
    buffer_hours: sumMinutesOfKind(allItems, "buffer") / 60,
    free_hours: sumMinutesOfKind(allItems, "free") / 60,
    travel_hours: sumMinutesOfKind(allItems, "travel") / 60,
    goal_hours: goalMinutes / 60,
    deadline_task_count: deadlineTaskCount,
    overload,
    explanation,
  });
}
