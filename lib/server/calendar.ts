import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DayViewSchema,
  MonthViewSchema,
  WeekViewSchema,
  type DayView,
  type FixedEvent,
  type MonthView,
  type ScheduleItem,
  type Task,
  type WeekView,
} from "@/lib/schemas";
import { addDays, diffMinutes, getWeekStart, toDateStr } from "@/lib/datetime";
import { expandFixedEvents } from "@/lib/planning/skeleton";
import { HttpError } from "./http";
import { getNow } from "./clock";
import { getActivePlan, listPlanItems, type PlanHeader } from "./repositories/plans";
import { listFixedEvents } from "./repositories/fixed-events";
import { listTasks } from "./repositories/tasks";

// GET /api/calendar/day・week・month の組み立て（plans-replan.md 11.3）。
// 日ごとに DB を読まず、範囲の分をまとめて読んでから日ごとに分ける

type CalendarSource = {
  now: string;
  plan: PlanHeader | null;
  planItems: { date: string; item: ScheduleItem }[]; // 有効な計画の全項目（1週間分）
  fixedEvents: FixedEvent[];                           // 展開前
  tasks: Task[];
};

async function loadSource(supabase: SupabaseClient, userId: string): Promise<CalendarSource> {
  const [now, plan, fixedEvents, tasks] = await Promise.all([
    getNow(userId, supabase),
    getActivePlan(supabase),
    listFixedEvents(supabase),
    listTasks(supabase),
  ]);
  const planItems = plan ? ((await listPlanItems(supabase, [plan.id])).get(plan.id) ?? []) : [];
  return { now, plan, planItems, fixedEvents, tasks };
}

// 表示用の値（DB には保存しない）。終わった項目は locked。タスクの完了状態は利用者が保存した値を使う。
// 進行中はタスク・固定予定・移動・睡眠なら locked、自由時間・バッファは locked: false（まだ使い方を変えられる）
export function withDisplayState(item: ScheduleItem, now: string): ScheduleItem {
  const nowMs = Date.parse(now);
  const startMs = Date.parse(item.start_at);
  const endMs = Date.parse(item.end_at);
  if (endMs <= nowMs) {
    return { ...item, locked: true };
  }
  if (startMs < nowMs) {
    return { ...item, locked: item.kind !== "free" && item.kind !== "buffer" };
  }
  return item;
}

// 計画のない日の表示：展開した固定予定をそのまま項目にする（睡眠・移動は出さない）。
// fixedEventId は展開前の元の id
function fixedEventToItem(event: FixedEvent, fixedEventId: string): ScheduleItem {
  return {
    id: event.id,
    kind: "fixed",
    title: event.title,
    start_at: event.start_at,
    end_at: event.end_at,
    location_id: event.location_id,
    task_id: null,
    fixed_event_id: fixedEventId,
    fixed_category: event.category,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
  };
}

// from〜to（両端を含む）の DayView
function buildDays(source: CalendarSource, from: string, to: string): DayView[] {
  const { now, plan, planItems, fixedEvents, tasks } = source;
  const planFrom = plan?.week_start ?? null;
  const planTo = plan ? addDays(plan.week_start, 6) : null;
  const inPlanWeek = (date: string) => planFrom !== null && planTo !== null && date >= planFrom && date <= planTo;

  // 計画のない日の分だけ固定予定を展開する（id は {元のid}_{日付}。9.1.2）
  const expanded = expandFixedEvents(fixedEvents, from, to, { purpose: "calendar" });
  const originalIds = new Set(fixedEvents.map((e) => e.id));
  const originalIdOf = (event: FixedEvent, date: string) =>
    originalIds.has(event.id) ? event.id : event.id.slice(0, -`_${date}`.length);

  const days: DayView[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const hasPlan = inPlanWeek(date);
    const items = hasPlan
      ? planItems
          .filter((e) => e.date === date)
          .map((e) => withDisplayState(e.item, now))
          .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
      : expanded
          .filter((e) => toDateStr(e.start_at) === date)
          .map((e) => fixedEventToItem(e, originalIdOf(e, date)));
    const deadlines = tasks
      .filter((t) => t.status !== "completed" && t.deadline_at !== null && toDateStr(t.deadline_at) === date)
      .map((t) => ({ task_id: t.id, title: t.title }));
    days.push(DayViewSchema.parse({ date, has_plan: hasPlan, items, deadlines }));
  }
  return days;
}

export async function getDayView(supabase: SupabaseClient, userId: string, date: string): Promise<DayView> {
  const source = await loadSource(supabase, userId);
  return buildDays(source, date, date)[0];
}

// start を含む週の月曜から7日分
export async function getWeekView(supabase: SupabaseClient, userId: string, start: string): Promise<WeekView> {
  const weekStart = getWeekStart(start);
  const source = await loadSource(supabase, userId);
  return WeekViewSchema.parse({ week_start: weekStart, days: buildDays(source, weekStart, addDays(weekStart, 6)) });
}

// "YYYY-MM"（01〜12）でなければ 400
export function requireValidMonth(month: string | null): string {
  if (month === null || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpError(400, "INVALID_REQUEST", "月は YYYY-MM の形で指定してください");
  }
  return month;
}

// 固定予定の種類 → 月表示の点の種類（task は項目の kind から）
const MONTH_KIND_BY_FIXED_CATEGORY: Partial<Record<FixedEvent["category"], "class" | "work" | "social">> = {
  class: "class",
  work: "work",
  social: "social",
  family: "social",
};

export async function getMonthView(supabase: SupabaseClient, userId: string, month: string): Promise<MonthView> {
  const first = `${month}-01`;
  let last = first;
  while (addDays(last, 1).startsWith(month)) last = addDays(last, 1);

  const source = await loadSource(supabase, userId);
  const days = buildDays(source, first, last).map((day) => {
    // 出た順（開始時刻の順）に最大3つ
    const kinds = new Set<"class" | "work" | "task" | "social">();
    for (const item of day.items) {
      if (item.kind === "task") kinds.add("task");
      if (item.kind === "fixed" && item.fixed_category) {
        const kind = MONTH_KIND_BY_FIXED_CATEGORY[item.fixed_category];
        if (kind) kinds.add(kind);
      }
    }
    const taskMinutes = day.items
      .filter((item) => item.kind === "task")
      .reduce((sum, item) => sum + diffMinutes(item.start_at, item.end_at), 0);
    return {
      date: day.date,
      has_plan: day.has_plan,
      kinds: Array.from(kinds).slice(0, 3),
      deadlines: day.deadlines,
      task_hours: taskMinutes / 60,
    };
  });
  return MonthViewSchema.parse({ month, days });
}
