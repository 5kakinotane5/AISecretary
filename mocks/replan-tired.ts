import { z } from "zod";
import { ReplanChangeSchema, ReplanProposalSchema, type DayPlan, type ScheduleItem } from "@/lib/schemas";
import { LOCATION_IDS } from "@/mocks/persona";
import { BALANCED_DAY_ITEMS } from "./plans/balanced";
import { bufferItem, freeItem, taskItem } from "./plans/shared";

// ---------- 5.10 再計画「今日は疲れた」（バランスプラン・10/5 18:00） ----------

type ReplanChange = z.infer<typeof ReplanChangeSchema>;

const CUTOFF = "2026-10-05T18:00:00+09:00";

function findItem(items: ScheduleItem[], id: string): ScheduleItem {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`未知の item id: ${id}`);
  return found;
}

function byStartAt(a: ScheduleItem, b: ScheduleItem): number {
  return a.start_at.localeCompare(b.start_at);
}

const originalMonday = BALANCED_DAY_ITEMS["2026-10-05"];
const originalListening = findItem(originalMonday, "bal_mon_6");
const originalEsA = findItem(originalMonday, "bal_mon_7");
const originalMailBuffer = findItem(originalMonday, "bal_mon_8");
const originalLateFree = findItem(originalMonday, "bal_mon_9");
const dinnerItem = findItem(originalMonday, "fx_mon_dinner");

/** 18:00時点のスナップショット：それより前に終わった項目は locked、レポートは completed（10.5・5.10章） */
const BEFORE_ITEMS: ScheduleItem[] = originalMonday.map((item) =>
  item.end_at > CUTOFF
    ? item
    : { ...item, locked: true, status: item.task_id === "task_report" ? "completed" : item.status },
);

const BEFORE: DayPlan = { date: "2026-10-05", items: BEFORE_ITEMS };

const restItem: ScheduleItem = {
  id: "replan_mon_rest",
  kind: "free",
  title: "休憩",
  start_at: "2026-10-05T18:00:00+09:00",
  end_at: "2026-10-05T18:30:00+09:00",
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
const vocabItem = taskItem("replan_mon_vocab", "2026-10-05", "18:30", "18:50", {
  taskId: "task_toeic_vocab",
  location: LOCATION_IDS.home,
});
const afterBuffer = bufferItem("replan_mon_buf", "2026-10-05", "18:50", "19:00", LOCATION_IDS.home);
const afterFree = freeItem("replan_mon_free", "2026-10-05", "19:45", "24:00", LOCATION_IDS.home);

const lockedMorningItems = BEFORE_ITEMS.filter((i) => i.end_at <= CUTOFF);

const AFTER: DayPlan = {
  date: "2026-10-05",
  items: [...lockedMorningItems, restItem, vocabItem, afterBuffer, dinnerItem, afterFree].sort(byStartAt),
};

const changes: ReplanChange[] = [
  {
    change_type: "replaced",
    before: originalListening,
    after: [restItem, vocabItem, afterBuffer],
    moved_to_date: null,
    reason:
      "疲労度が高いため、集中力が必要なリスニング演習を、短時間でできる単語学習に切り替えて先に休憩を入れました",
  },
  {
    change_type: "moved",
    before: originalEsA,
    after: [],
    moved_to_date: "2026-10-07",
    reason: "集中力が必要なESは今日は避けました。締切（10/12）には十分間に合います",
  },
  {
    change_type: "removed",
    before: originalMailBuffer,
    after: [],
    moved_to_date: null,
    reason: "作業がなくなったため、自由時間にまとめました",
  },
  {
    change_type: "replaced",
    before: originalLateFree,
    after: [afterFree],
    moved_to_date: null,
    reason: "夜はゆっくり休めるようにしました",
  },
];

// ---------- ほかの日への影響：水曜（ES下書き60分を追加） ----------
const originalWednesday = BALANCED_DAY_ITEMS["2026-10-07"];
const wedEsA = taskItem("replan_wed_es_a", "2026-10-07", "20:00", "21:00", {
  taskId: "task_es_a",
  location: LOCATION_IDS.home,
});
const wedFreeShrunk = freeItem("replan_wed_free", "2026-10-07", "21:00", "24:00", LOCATION_IDS.home);

/** 振り替え後の10/7（水）：元の20:00-24:00自由時間をES下書き＋自由時間に分ける */
export const REPLAN_WED_AFTER: DayPlan = {
  date: "2026-10-07",
  items: [...originalWednesday.filter((i) => i.id !== "bal_wed_8"), wedEsA, wedFreeShrunk].sort(byStartAt),
};

// ---------- ほかの日への影響：木曜（TOEIC リスニングを90分→130分に） ----------
const originalThursday = BALANCED_DAY_ITEMS["2026-10-08"];
const thuListeningExtended = taskItem("replan_thu_listening", "2026-10-08", "14:15", "16:25", {
  taskId: "task_toeic_listening",
  location: LOCATION_IDS.home,
});
const thuFreeShrunk = freeItem("replan_thu_free", "2026-10-08", "16:25", "19:00", LOCATION_IDS.home);

/** 振り替え後の10/8（木）：TOEIC リスニングを90分→130分に延長し、自由時間を後ろへずらす */
export const REPLAN_THU_AFTER: DayPlan = {
  date: "2026-10-08",
  items: [
    ...originalThursday.filter((i) => i.id !== "bal_thu_5" && i.id !== "bal_thu_6"),
    thuListeningExtended,
    thuFreeShrunk,
  ].sort(byStartAt),
};

const other_day_changes: ReplanChange[] = [
  {
    change_type: "moved",
    before: null,
    after: [wedEsA],
    moved_to_date: "2026-10-07",
    reason: "水曜の夜は他の予定が少なく、締切前に余裕を持って終えられます",
  },
  {
    change_type: "moved",
    before: null,
    after: [thuListeningExtended],
    moved_to_date: "2026-10-08",
    reason: "週6時間の目標を保つため、空きの多い木曜に振り替えました",
  },
];

export const REPLAN_TIRED = ReplanProposalSchema.parse({
  proposal_id: "replan_mon_tired",
  date: "2026-10-05",
  intent: {
    type: "state_change",
    fatigue: "high",
    task_changes: [],
    new_fixed_events: [],
    preference_changes: [],
  },
  before: BEFORE,
  after: AFTER,
  changes,
  other_day_changes,
  summary_message:
    "お疲れさまです。今夜は軽めにして、ESは水曜、TOEICの残り40分は木曜に回しました。夕食の予定はそのままで、週6時間の目標とESの締切も守れます。",
});
