import { ScheduleCandidateSchema, type DayPlan, type ScheduleItem } from "@/lib/schemas";
import { LOCATION_IDS } from "@/mocks/persona";
import { summarizePlan } from "@/lib/mock/summarize";
import { WEEKDAY_TRAVEL, bufferItem, buildDay, freeItem, monMorningTravel, taskItem, travelItem } from "./shared";

const EXPLANATION =
  "締切のあるレポートとESを早めに終わらせ、企業研究も進めるプランです。空き時間は少なめです。";

// ---------- 月曜 10/5 ----------
const MON: ScheduleItem[] = [
  monMorningTravel(),
  taskItem("int_mon_1", "2026-10-05", "13:00", "15:00", { taskId: "task_report", location: LOCATION_IDS.univ }),
  bufferItem("int_mon_2", "2026-10-05", "15:00", "15:15", LOCATION_IDS.univ),
  travelItem("int_mon_3", "2026-10-05", "15:15", "16:05", LOCATION_IDS.univ, LOCATION_IDS.home, "walk_train"),
  freeItem("int_mon_4", "2026-10-05", "16:05", "16:45", LOCATION_IDS.home),
  bufferItem("int_mon_5", "2026-10-05", "16:45", "17:00", LOCATION_IDS.home, "task_mail"),
  taskItem("int_mon_6", "2026-10-05", "17:00", "18:30", { taskId: "task_toeic_listening", location: LOCATION_IDS.home }),
  freeItem("int_mon_7", "2026-10-05", "18:30", "19:00", LOCATION_IDS.home),
  taskItem("int_mon_8", "2026-10-05", "19:45", "21:15", { taskId: "task_es_a", location: LOCATION_IDS.home }),
  bufferItem("int_mon_9", "2026-10-05", "21:15", "21:30", LOCATION_IDS.home),
  taskItem("int_mon_10", "2026-10-05", "21:30", "22:00", { taskId: "task_research", location: LOCATION_IDS.home }),
  freeItem("int_mon_11", "2026-10-05", "22:00", "24:00", LOCATION_IDS.home),
];

// ---------- 火曜 10/6 ----------
const TUE: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-06"],
  bufferItem("int_tue_1", "2026-10-06", "08:00", "08:15", LOCATION_IDS.home),
  taskItem("int_tue_2", "2026-10-06", "08:15", "09:15", { taskId: "task_report", location: LOCATION_IDS.home, completed: true }),
  bufferItem("int_tue_3", "2026-10-06", "09:15", "09:30", LOCATION_IDS.home),
  taskItem("int_tue_4", "2026-10-06", "09:30", "10:30", { taskId: "task_toeic_listening", location: LOCATION_IDS.home }),
  freeItem("int_tue_5", "2026-10-06", "10:30", "11:30", LOCATION_IDS.home),
  bufferItem("int_tue_6", "2026-10-06", "16:50", "17:05", LOCATION_IDS.cafe),
  taskItem("int_tue_7", "2026-10-06", "17:05", "17:35", { taskId: "task_toeic_vocab", location: LOCATION_IDS.cafe }),
  freeItem("int_tue_8", "2026-10-06", "17:35", "18:00", LOCATION_IDS.cafe),
  bufferItem("int_tue_9", "2026-10-06", "22:45", "23:00", LOCATION_IDS.home),
  freeItem("int_tue_10", "2026-10-06", "23:00", "24:00", LOCATION_IDS.home),
];

// ---------- 水曜 10/7 ----------
const WED: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-07"],
  bufferItem("int_wed_1", "2026-10-07", "08:00", "08:15", LOCATION_IDS.home),
  taskItem("int_wed_2", "2026-10-07", "08:15", "08:45", { taskId: "task_es_a", location: LOCATION_IDS.home, completed: true }),
  bufferItem("int_wed_3", "2026-10-07", "08:45", "09:00", LOCATION_IDS.home),
  freeItem("int_wed_4", "2026-10-07", "09:00", "09:45", LOCATION_IDS.home),
  bufferItem("int_wed_5", "2026-10-07", "13:00", "13:15", LOCATION_IDS.univ),
  taskItem("int_wed_6", "2026-10-07", "13:15", "14:15", { taskId: "task_toeic_listening", location: LOCATION_IDS.univ }),
  freeItem("int_wed_7", "2026-10-07", "14:15", "14:30", LOCATION_IDS.univ),
  bufferItem("int_wed_8", "2026-10-07", "17:05", "17:20", LOCATION_IDS.home),
  freeItem("int_wed_9", "2026-10-07", "17:20", "19:00", LOCATION_IDS.home),
  bufferItem("int_wed_10", "2026-10-07", "19:45", "20:00", LOCATION_IDS.home),
  taskItem("int_wed_11", "2026-10-07", "20:00", "22:00", { taskId: "task_research", location: LOCATION_IDS.home }),
  freeItem("int_wed_12", "2026-10-07", "22:00", "24:00", LOCATION_IDS.home),
];

// ---------- 木曜 10/8 ----------
const THU: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-08"],
  taskItem("int_thu_1", "2026-10-08", "11:25", "11:55", { taskId: "task_notes", location: LOCATION_IDS.home }),
  freeItem("int_thu_2", "2026-10-08", "11:55", "12:00", LOCATION_IDS.home),
  bufferItem("int_thu_3", "2026-10-08", "12:45", "13:00", LOCATION_IDS.home),
  taskItem("int_thu_4", "2026-10-08", "13:00", "14:30", { taskId: "task_toeic_listening", location: LOCATION_IDS.home }),
  bufferItem("int_thu_5", "2026-10-08", "14:30", "14:45", LOCATION_IDS.home),
  taskItem("int_thu_6", "2026-10-08", "14:45", "15:15", { taskId: "task_research", location: LOCATION_IDS.home }),
  freeItem("int_thu_7", "2026-10-08", "15:15", "19:00", LOCATION_IDS.home),
  bufferItem("int_thu_8", "2026-10-08", "19:45", "20:00", LOCATION_IDS.home),
  freeItem("int_thu_9", "2026-10-08", "20:00", "24:00", LOCATION_IDS.home),
];

// ---------- 金曜 10/9 ----------
const FRI: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-09"],
  bufferItem("int_fri_1", "2026-10-09", "08:00", "08:15", LOCATION_IDS.home, "task_mail"),
  freeItem("int_fri_2", "2026-10-09", "08:15", "09:45", LOCATION_IDS.home),
  bufferItem("int_fri_3", "2026-10-09", "15:25", "15:40", LOCATION_IDS.home),
  freeItem("int_fri_4", "2026-10-09", "15:40", "18:45", LOCATION_IDS.home),
  bufferItem("int_fri_5", "2026-10-09", "21:15", "21:30", LOCATION_IDS.home),
  freeItem("int_fri_6", "2026-10-09", "21:30", "24:00", LOCATION_IDS.home),
];

// ---------- 土曜 10/10 ----------
const SAT: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-10"],
  bufferItem("int_sat_1", "2026-10-10", "08:00", "08:15", LOCATION_IDS.home),
  freeItem("int_sat_2", "2026-10-10", "08:15", "09:45", LOCATION_IDS.home),
  bufferItem("int_sat_3", "2026-10-10", "15:15", "15:30", LOCATION_IDS.home),
  taskItem("int_sat_4", "2026-10-10", "15:30", "16:00", { taskId: "task_toeic_vocab", location: LOCATION_IDS.home }),
  freeItem("int_sat_5", "2026-10-10", "16:00", "19:00", LOCATION_IDS.home),
  bufferItem("int_sat_6", "2026-10-10", "19:45", "20:00", LOCATION_IDS.home),
  freeItem("int_sat_7", "2026-10-10", "20:00", "24:00", LOCATION_IDS.home),
];

// ---------- 日曜 10/11（タスクなし・休息日） ----------
const SUN: ScheduleItem[] = [
  ...WEEKDAY_TRAVEL["2026-10-11"],
  bufferItem("int_sun_1", "2026-10-11", "08:00", "08:15", LOCATION_IDS.home),
  freeItem("int_sun_2", "2026-10-11", "08:15", "12:00", LOCATION_IDS.home),
  bufferItem("int_sun_3", "2026-10-11", "13:30", "13:45", LOCATION_IDS.home),
  freeItem("int_sun_4", "2026-10-11", "13:45", "19:00", LOCATION_IDS.home),
  bufferItem("int_sun_5", "2026-10-11", "19:45", "20:00", LOCATION_IDS.home),
  freeItem("int_sun_6", "2026-10-11", "20:00", "24:00", LOCATION_IDS.home),
];

export const INTENSIVE_DAY_ITEMS: Record<string, ScheduleItem[]> = {
  "2026-10-05": buildDay("2026-10-05", MON),
  "2026-10-06": buildDay("2026-10-06", TUE),
  "2026-10-07": buildDay("2026-10-07", WED),
  "2026-10-08": buildDay("2026-10-08", THU),
  "2026-10-09": buildDay("2026-10-09", FRI),
  "2026-10-10": buildDay("2026-10-10", SAT),
  "2026-10-11": buildDay("2026-10-11", SUN),
};

const DAYS: DayPlan[] = Object.entries(INTENSIVE_DAY_ITEMS).map(([date, items]) => ({ date, items }));

export const INTENSIVE_PLAN = ScheduleCandidateSchema.parse({
  id: "plan_intensive",
  style: "intensive",
  label: "集中プラン",
  week_start: "2026-10-05",
  days: DAYS,
  summary: summarizePlan(DAYS, EXPLANATION),
});
