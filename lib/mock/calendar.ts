import {
  DayViewSchema,
  MonthViewSchema,
  WeekViewSchema,
  type DayView,
  type FixedEvent,
  type MonthView,
  type PlanStyle,
  type ScheduleItem,
  type WeekView,
} from "@/lib/schemas";
import { addDays, diffMinutes, getWeekdayJa, toDateStr } from "@/lib/datetime";
import { FIXED_EVENTS } from "@/mocks/fixed-events";
import { TASKS } from "@/mocks/tasks";
import { INTENSIVE_PLAN } from "@/mocks/plans/intensive";
import { BALANCED_PLAN } from "@/mocks/plans/balanced";
import { RELAXED_PLAN } from "@/mocks/plans/relaxed";
import { REPLAN_TIRED, REPLAN_WED_AFTER, REPLAN_THU_AFTER } from "@/mocks/replan-tired";
import { getState } from "./store";

// ---------- 4章 GET /api/calendar/day・week・month の共通の組み立て ----------
// 4.1章・10章のとおり、replan_accepted が true のときは 10/5・10/7・10/8 を再計画後の内容にする。
// それ以外の日は選択中のプラン（active_plan_style）の内容、計画のない週は5.6章の固定予定を
// 曜日・時刻はそのままに他の週へ展開して返す（移動は表示しない）。

const PLAN_BY_STYLE: Record<PlanStyle, typeof INTENSIVE_PLAN> = {
  intensive: INTENSIVE_PLAN,
  balanced: BALANCED_PLAN,
  relaxed: RELAXED_PLAN,
};

function replanOverrideItems(date: string): ScheduleItem[] | null {
  if (!getState().replan_accepted) return null;
  if (date === REPLAN_TIRED.after.date) return REPLAN_TIRED.after.items;
  if (date === REPLAN_WED_AFTER.date) return REPLAN_WED_AFTER.items;
  if (date === REPLAN_THU_AFTER.date) return REPLAN_THU_AFTER.items;
  return null;
}

function activePlanDayItems(date: string): ScheduleItem[] | null {
  const plan = PLAN_BY_STYLE[getState().active_plan_style];
  return plan.days.find((d) => d.date === date)?.items ?? null;
}

/** recurrence: "weekly" の固定予定を、同じ曜日・時刻のまま別の日付に展開する（10.14章） */
function projectFixedEventToDate(event: FixedEvent, date: string): ScheduleItem {
  const startTime = event.start_at.slice(10); // "T07:30:00+09:00"
  const endTime = event.end_at.slice(10);
  const isOriginalDate = event.start_at.startsWith(date);
  return {
    id: isOriginalDate ? event.id : `${event.id}_${date}`,
    kind: "fixed",
    title: event.title,
    start_at: `${date}${startTime}`,
    end_at: `${date}${endTime}`,
    location_id: event.location_id,
    task_id: null,
    fixed_event_id: event.id,
    fixed_category: event.category,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
  };
}

/** 計画のない週は固定予定だけを表示し、移動は表示しない（5.6章） */
function recurringFixedItemsFor(date: string): ScheduleItem[] {
  const weekday = getWeekdayJa(date);
  return FIXED_EVENTS.filter((e) => e.recurrence === "weekly" && getWeekdayJa(e.start_at) === weekday).map((e) =>
    projectFixedEventToDate(e, date),
  );
}

function deadlinesFor(date: string): { task_id: string; title: string }[] {
  return TASKS.filter((t) => t.deadline_at !== null && toDateStr(t.deadline_at) === date).map((t) => ({
    task_id: t.id,
    title: t.title,
  }));
}

export function buildDayView(date: string): DayView {
  const overrideItems = replanOverrideItems(date);
  if (overrideItems) {
    return DayViewSchema.parse({ date, has_plan: true, items: overrideItems, deadlines: deadlinesFor(date) });
  }
  const planItems = activePlanDayItems(date);
  if (planItems) {
    return DayViewSchema.parse({ date, has_plan: true, items: planItems, deadlines: deadlinesFor(date) });
  }
  return DayViewSchema.parse({
    date,
    has_plan: false,
    items: recurringFixedItemsFor(date),
    deadlines: deadlinesFor(date),
  });
}

export function buildWeekView(weekStart: string): WeekView {
  const days = Array.from({ length: 7 }, (_, i) => buildDayView(addDays(weekStart, i)));
  return WeekViewSchema.parse({ week_start: weekStart, days });
}

const MONTH_KIND_BY_FIXED_CATEGORY: Partial<Record<string, "class" | "work" | "social">> = {
  class: "class",
  work: "work",
  social: "social",
  family: "social",
};

export function buildMonthView(month: string): MonthView {
  if (month !== "2026-10") {
    // 2.6章：2026年10月以外は空の表示にする
    return MonthViewSchema.parse({ month, days: [] });
  }

  const days = Array.from({ length: 31 }, (_, i) => {
    const date = `2026-10-${String(i + 1).padStart(2, "0")}`;
    const dayView = buildDayView(date);

    const kinds = new Set<"class" | "work" | "task" | "social">();
    for (const item of dayView.items) {
      if (item.kind === "task") kinds.add("task");
      if (item.kind === "fixed" && item.fixed_category) {
        const kind = MONTH_KIND_BY_FIXED_CATEGORY[item.fixed_category];
        if (kind) kinds.add(kind);
      }
    }

    const taskMinutes = dayView.items
      .filter((item) => item.kind === "task")
      .reduce((sum, item) => sum + diffMinutes(item.start_at, item.end_at), 0);

    return {
      date,
      has_plan: dayView.has_plan,
      kinds: Array.from(kinds).slice(0, 3),
      deadlines: dayView.deadlines,
      task_hours: taskMinutes / 60,
    };
  });

  return MonthViewSchema.parse({ month, days });
}
