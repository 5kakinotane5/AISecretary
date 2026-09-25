import { ScheduleCandidateSchema, type DayPlan, type ScheduleItem } from "@/lib/schemas";
import { LOCATION_IDS } from "@/mocks/persona";
import { summarizePlan } from "@/lib/mock/summarize";
import { WEEKDAY_TRAVEL, bufferItem, buildDay, freeItem, monMorningTravel, taskItem, travelItem } from "./shared";

const EXPLANATION = "締切に間に合う範囲でゆっくり進め、休む時間とバッファを多めにとるプランです。";

// ---------- 月曜 10/5 ----------
const MON: ScheduleItem[] = [
  monMorningTravel(),
  taskItem("rel_mon_1", "2026-10-05", "13:00", "14:00", { taskId: "task_report", location: LOCATION_IDS.univ }),
  bufferItem("rel_mon_2", "2026-10-05", "14:00", "14:30", LOCATION_IDS.univ, "task_notes"),
  travelItem("rel_mon_3", "2026-10-05", "14:30", "15:20", LOCATION_IDS.univ, LOCATION_IDS.home, "walk_train"),
  freeItem("rel_mon_4", "2026-10-05", "15:20", "18:30", LOCATION_IDS.home),
  taskItem("rel_mon_5", "2026-10-05", "18:30", "19:00", { taskId: "task_toeic_vocab", location: LOCATION_IDS.home }),
  bufferItem("rel_mon_6", "2026-10-05", "19:45", "20:15", LOCATION_IDS.home, "task_mail"),
  freeItem("rel_mon_7", "2026-10-05", "20:15", "24:00", LOCATION_IDS.home),
];

// ---------- 火曜 10/6 ----------
const TUE: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-06"],
  bufferItem("rel_tue_1", "2026-10-06", "08:00", "08:15", LOCATION_IDS.home),
  freeItem("rel_tue_2", "2026-10-06", "08:15", "11:30", LOCATION_IDS.home),
  bufferItem("rel_tue_3", "2026-10-06", "16:50", "17:05", LOCATION_IDS.cafe),
  taskItem("rel_tue_4", "2026-10-06", "17:05", "17:35", { taskId: "task_toeic_vocab", location: LOCATION_IDS.cafe }),
  freeItem("rel_tue_5", "2026-10-06", "17:35", "18:00", LOCATION_IDS.cafe),
  bufferItem("rel_tue_6", "2026-10-06", "22:45", "23:00", LOCATION_IDS.home),
  freeItem("rel_tue_7", "2026-10-06", "23:00", "24:00", LOCATION_IDS.home),
];

// ---------- 水曜 10/7 ----------
const WED: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-07"],
  bufferItem("rel_wed_1", "2026-10-07", "08:00", "08:15", LOCATION_IDS.home),
  taskItem("rel_wed_2", "2026-10-07", "08:15", "09:15", { taskId: "task_report", location: LOCATION_IDS.home }),
  freeItem("rel_wed_3", "2026-10-07", "09:15", "09:45", LOCATION_IDS.home),
  bufferItem("rel_wed_4", "2026-10-07", "13:00", "13:15", LOCATION_IDS.univ),
  taskItem("rel_wed_5", "2026-10-07", "13:15", "14:15", { taskId: "task_toeic_listening", location: LOCATION_IDS.univ }),
  freeItem("rel_wed_6", "2026-10-07", "14:15", "14:30", LOCATION_IDS.univ),
  bufferItem("rel_wed_7", "2026-10-07", "17:05", "17:20", LOCATION_IDS.home),
  freeItem("rel_wed_8", "2026-10-07", "17:20", "19:00", LOCATION_IDS.home),
  bufferItem("rel_wed_9", "2026-10-07", "19:45", "20:00", LOCATION_IDS.home),
  freeItem("rel_wed_10", "2026-10-07", "20:00", "24:00", LOCATION_IDS.home),
];

// ---------- 木曜 10/8 ----------
const THU: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-08"],
  freeItem("rel_thu_1", "2026-10-08", "11:25", "12:00", LOCATION_IDS.home),
  bufferItem("rel_thu_2", "2026-10-08", "12:45", "13:00", LOCATION_IDS.home),
  taskItem("rel_thu_3", "2026-10-08", "13:00", "14:00", { taskId: "task_report", location: LOCATION_IDS.home, completed: true }),
  bufferItem("rel_thu_4", "2026-10-08", "14:00", "14:15", LOCATION_IDS.home),
  taskItem("rel_thu_5", "2026-10-08", "14:15", "15:45", { taskId: "task_toeic_listening", location: LOCATION_IDS.home }),
  freeItem("rel_thu_6", "2026-10-08", "15:45", "19:00", LOCATION_IDS.home),
  bufferItem("rel_thu_7", "2026-10-08", "19:45", "20:00", LOCATION_IDS.home),
  freeItem("rel_thu_8", "2026-10-08", "20:00", "24:00", LOCATION_IDS.home),
];

// ---------- 金曜 10/9（タスクなし） ----------
const FRI: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-09"],
  bufferItem("rel_fri_1", "2026-10-09", "08:00", "08:15", LOCATION_IDS.home),
  freeItem("rel_fri_2", "2026-10-09", "08:15", "09:45", LOCATION_IDS.home),
  bufferItem("rel_fri_3", "2026-10-09", "15:25", "15:40", LOCATION_IDS.home),
  freeItem("rel_fri_4", "2026-10-09", "15:40", "18:45", LOCATION_IDS.home),
  bufferItem("rel_fri_5", "2026-10-09", "21:15", "21:30", LOCATION_IDS.home),
  freeItem("rel_fri_6", "2026-10-09", "21:30", "24:00", LOCATION_IDS.home),
];

// ---------- 土曜 10/10 ----------
const SAT: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-10"],
  bufferItem("rel_sat_1", "2026-10-10", "08:00", "08:15", LOCATION_IDS.home),
  taskItem("rel_sat_2", "2026-10-10", "08:15", "09:15", { taskId: "task_es_a", location: LOCATION_IDS.home }),
  freeItem("rel_sat_3", "2026-10-10", "09:15", "09:45", LOCATION_IDS.home),
  bufferItem("rel_sat_4", "2026-10-10", "15:15", "15:30", LOCATION_IDS.home),
  taskItem("rel_sat_5", "2026-10-10", "15:30", "16:30", { taskId: "task_toeic_listening", location: LOCATION_IDS.home }),
  freeItem("rel_sat_6", "2026-10-10", "16:30", "19:00", LOCATION_IDS.home),
  bufferItem("rel_sat_7", "2026-10-10", "19:45", "20:00", LOCATION_IDS.home),
  freeItem("rel_sat_8", "2026-10-10", "20:00", "24:00", LOCATION_IDS.home),
];

// ---------- 日曜 10/11 ----------
const SUN: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-11"],
  bufferItem("rel_sun_1", "2026-10-11", "08:00", "08:15", LOCATION_IDS.home),
  taskItem("rel_sun_2", "2026-10-11", "08:15", "09:15", { taskId: "task_es_a", location: LOCATION_IDS.home, completed: true }),
  bufferItem("rel_sun_3", "2026-10-11", "09:15", "09:30", LOCATION_IDS.home),
  taskItem("rel_sun_4", "2026-10-11", "09:30", "11:00", { taskId: "task_toeic_listening", location: LOCATION_IDS.home }),
  freeItem("rel_sun_5", "2026-10-11", "11:00", "12:00", LOCATION_IDS.home),
  bufferItem("rel_sun_6", "2026-10-11", "13:30", "13:45", LOCATION_IDS.home),
  freeItem("rel_sun_7", "2026-10-11", "13:45", "19:00", LOCATION_IDS.home),
  bufferItem("rel_sun_8", "2026-10-11", "19:45", "20:00", LOCATION_IDS.home),
  freeItem("rel_sun_9", "2026-10-11", "20:00", "24:00", LOCATION_IDS.home),
];

export const RELAXED_DAY_ITEMS: Record<string, ScheduleItem[]> = {
  "2026-10-05": buildDay("2026-10-05", MON),
  "2026-10-06": buildDay("2026-10-06", TUE),
  "2026-10-07": buildDay("2026-10-07", WED),
  "2026-10-08": buildDay("2026-10-08", THU),
  "2026-10-09": buildDay("2026-10-09", FRI),
  "2026-10-10": buildDay("2026-10-10", SAT),
  "2026-10-11": buildDay("2026-10-11", SUN),
};

const DAYS: DayPlan[] = Object.entries(RELAXED_DAY_ITEMS).map(([date, items]) => ({ date, items }));

export const RELAXED_PLAN = ScheduleCandidateSchema.parse({
  id: "plan_relaxed",
  style: "relaxed",
  label: "ゆとりプラン",
  week_start: "2026-10-05",
  days: DAYS,
  summary: summarizePlan(DAYS, EXPLANATION),
});
