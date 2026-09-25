import type { ScheduleItem, TravelMode } from "@/lib/schemas";
import { LOCATION_IDS } from "@/mocks/persona";
import { FIXED_EVENTS } from "@/mocks/fixed-events";
import { TASKS } from "@/mocks/tasks";

/** tasks.ts の title をそのまま使う（表示名の手書き二重管理を避ける） */
export function taskTitle(taskId: string): string {
  const task = TASKS.find((t) => t.id === taskId);
  if (!task) throw new Error(`未知の task_id: ${taskId}`);
  return task.title;
}

// ---------- 5.9 スケジュール3案・共通の組み立て部品 ----------
// 固定予定・睡眠・移動（月曜の帰宅移動を除く）は3案とも同じなので、ここで1回だけ定義し、
// mocks/plans/intensive.ts・balanced.ts・relaxed.ts から共有する。

function iso(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

/** 睡眠 0:00–7:30（lib/mock/validate.ts の SLEEP_OVERLAP 検査対象。UserPreference と同じ範囲） */
export function sleepItem(date: string): ScheduleItem {
  return {
    id: `slp_${date}`,
    kind: "sleep",
    title: "睡眠",
    start_at: iso(date, "00:00"),
    end_at: iso(date, "07:30"),
    location_id: LOCATION_IDS.home,
    task_id: null,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
  };
}

/** その日の固定予定（5.6）をそのまま ScheduleItem に変換する */
export function fixedItemsOf(date: string): ScheduleItem[] {
  return FIXED_EVENTS.filter((e) => e.start_at.startsWith(date)).map((e) => ({
    id: e.id,
    kind: "fixed",
    title: e.title,
    start_at: e.start_at,
    end_at: e.end_at,
    location_id: e.location_id,
    task_id: null,
    fixed_event_id: e.id,
    fixed_category: e.category,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
  }));
}

export function travelItem(
  id: string,
  date: string,
  start: string,
  end: string,
  from: string,
  to: string,
  mode: TravelMode,
): ScheduleItem {
  return {
    id,
    kind: "travel",
    title: "移動",
    start_at: iso(date, start),
    end_at: iso(date, end),
    location_id: null,
    task_id: null,
    fixed_event_id: null,
    fixed_category: null,
    travel: { from_location_id: from, to_location_id: to, mode },
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
  };
}

export function taskItem(
  id: string,
  date: string,
  start: string,
  end: string,
  opts: { taskId: string; location: string; reason?: string | null; completed?: boolean },
): ScheduleItem {
  return {
    id,
    kind: "task",
    title: taskTitle(opts.taskId),
    start_at: iso(date, start),
    end_at: iso(date, end),
    location_id: opts.location,
    task_id: opts.taskId,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: opts.completed ? "completed" : "planned",
    reason: opts.reason ?? null,
  };
}

export function bufferItem(
  id: string,
  date: string,
  start: string,
  end: string,
  location: string,
  suggestedTaskId: string | null = null,
): ScheduleItem {
  return {
    id,
    kind: "buffer",
    title: "バッファ",
    start_at: iso(date, start),
    end_at: iso(date, end),
    location_id: location,
    task_id: null,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: suggestedTaskId,
    locked: false,
    status: "planned",
    reason: null,
  };
}

export function freeItem(id: string, date: string, start: string, end: string, location: string): ScheduleItem {
  return {
    id,
    kind: "free",
    title: "自由時間",
    start_at: iso(date, start),
    end_at: iso(date, end),
    location_id: location,
    task_id: null,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
  };
}

function byStartAt(a: ScheduleItem, b: ScheduleItem): number {
  return a.start_at.localeCompare(b.start_at);
}

/** 固定予定・睡眠・案ごとの項目をまとめて、時刻順に並べる */
export function buildDay(date: string, items: ScheduleItem[]): ScheduleItem[] {
  return [sleepItem(date), ...fixedItemsOf(date), ...items].sort(byStartAt);
}

// ---------- 火〜日は3案とも移動が共通（10章のとおり、配置は移動に触れない） ----------
export const WEEKDAY_TRAVEL: Record<string, ScheduleItem[]> = {
  "2026-10-06": [
    travelItem("trv_tue_1", "2026-10-06", "12:05", "12:55", LOCATION_IDS.home, LOCATION_IDS.univ, "walk_train"),
    travelItem("trv_tue_2", "2026-10-06", "16:15", "16:50", LOCATION_IDS.univ, LOCATION_IDS.cafe, "walk_train"),
    travelItem("trv_tue_3", "2026-10-06", "22:00", "22:12", LOCATION_IDS.cafe, LOCATION_IDS.home, "walk"),
  ],
  "2026-10-07": [
    travelItem("trv_wed_1", "2026-10-07", "09:45", "10:35", LOCATION_IDS.home, LOCATION_IDS.univ, "walk_train"),
    travelItem("trv_wed_2", "2026-10-07", "16:15", "17:05", LOCATION_IDS.univ, LOCATION_IDS.home, "walk_train"),
  ],
  "2026-10-08": [
    travelItem("trv_thu_1", "2026-10-08", "08:05", "08:55", LOCATION_IDS.home, LOCATION_IDS.univ, "walk_train"),
    travelItem("trv_thu_2", "2026-10-08", "10:35", "11:25", LOCATION_IDS.univ, LOCATION_IDS.home, "walk_train"),
  ],
  "2026-10-09": [
    travelItem("trv_fri_1", "2026-10-09", "09:45", "10:35", LOCATION_IDS.home, LOCATION_IDS.univ, "walk_train"),
    travelItem("trv_fri_2", "2026-10-09", "14:35", "15:25", LOCATION_IDS.univ, LOCATION_IDS.home, "walk_train"),
    travelItem("trv_fri_3", "2026-10-09", "18:45", "18:57", LOCATION_IDS.home, LOCATION_IDS.station, "walk"),
    travelItem("trv_fri_4", "2026-10-09", "21:00", "21:12", LOCATION_IDS.station, LOCATION_IDS.home, "walk"),
  ],
  "2026-10-10": [
    travelItem("trv_sat_1", "2026-10-10", "09:45", "09:57", LOCATION_IDS.home, LOCATION_IDS.cafe, "walk"),
    travelItem("trv_sat_2", "2026-10-10", "15:00", "15:12", LOCATION_IDS.cafe, LOCATION_IDS.home, "walk"),
  ],
  "2026-10-11": [],
};

/** 月曜朝の通学（8:05–8:55）は3案とも共通。帰宅の移動は案ごとに時刻が違うため、各ファイルで個別に定義する */
export function monMorningTravel(): ScheduleItem {
  return travelItem("trv_mon_am", "2026-10-05", "08:05", "08:55", LOCATION_IDS.home, LOCATION_IDS.univ, "walk_train");
}
