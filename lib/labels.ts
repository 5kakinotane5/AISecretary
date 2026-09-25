import type { ComponentType } from "react";
import {
  ArrowRightLeft,
  Briefcase,
  Bus,
  Bike,
  CalendarClock,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  Coffee,
  Footprints,
  Heart,
  Hourglass,
  House,
  Map as MapIcon,
  MessageCircle,
  Moon,
  Repeat,
  Settings,
  School,
  Timer,
  TrainFront,
  Utensils,
  type LucideProps,
} from "lucide-react";
import type { z } from "zod";
import type {
  FixedCategorySchema,
  GoalPlanStyle,
  ItemKindSchema,
  Level,
  MonthView,
  PlanStyleSchema,
  ReplanChange,
  TravelModeSchema,
} from "./schemas";
import { formatMonthDay, formatTime, getJstHour } from "./datetime";

type ItemKind = z.infer<typeof ItemKindSchema>;
type FixedCategory = z.infer<typeof FixedCategorySchema>;
type TravelMode = z.infer<typeof TravelModeSchema>;
type PlanStyle = z.infer<typeof PlanStyleSchema>;

type LucideIcon = ComponentType<LucideProps>;

/** タイムライン・カレンダーで共通に使う、予定の種類ごとの見た目（design-spec.md 2.3・5.4・9.3・9.6）
 * 色は値を持たず、app/globals.css で定義するCSS変数名だけを持つ（design-spec.md 9.6）。
 */
export type ItemAppearance = {
  /** 表示名 */
  label: string;
  /** 丸印の中に置くアイコン（travel は使わず getTravelIcon を使う） */
  icon: LucideIcon;
  /** 丸印を描くかどうか。travel・sleep は丸印を置かない */
  hasCircle: boolean;
  /** 丸印が塗りつぶしか、破線の輪か（buffer だけ輪） */
  circleStyle: "filled" | "ring";
  /** 丸印の色（CSS変数名。filled は塗り色、ring は線の色） */
  circleColor: string;
  /** 丸印内アイコンの色（CSS変数名。filled は白、buffer の輪は紫） */
  iconColor: string;
  /** ブロックの背景色（CSS変数名） */
  blockBg: string;
  /** ブロックの枠が破線か（travel・buffer） */
  dashedBorder: boolean;
};

const FIXED_APPEARANCE: Record<FixedCategory, ItemAppearance> = {
  class: {
    label: "授業・バイトなど",
    icon: School,
    hasCircle: true,
    circleStyle: "filled",
    circleColor: "var(--kind-fixed)",
    iconColor: "white",
    blockBg: "var(--kind-fixed-bg)",
    dashedBorder: false,
  },
  work: {
    label: "授業・バイトなど",
    icon: Briefcase,
    hasCircle: true,
    circleStyle: "filled",
    circleColor: "var(--kind-fixed)",
    iconColor: "white",
    blockBg: "var(--kind-fixed-bg)",
    dashedBorder: false,
  },
  other: {
    label: "授業・バイトなど",
    // design-spec.md 9.7：School／Briefcaseと紛らわしいため CalendarClock にする
    icon: CalendarClock,
    hasCircle: true,
    circleStyle: "filled",
    circleColor: "var(--kind-fixed)",
    iconColor: "white",
    blockBg: "var(--kind-fixed-bg)",
    dashedBorder: false,
  },
  meal: {
    label: "食事",
    icon: Utensils,
    hasCircle: true,
    circleStyle: "filled",
    circleColor: "var(--kind-meal)",
    iconColor: "white",
    blockBg: "var(--kind-meal-bg)",
    dashedBorder: false,
  },
  social: {
    label: "友人・家族との時間",
    icon: Heart,
    hasCircle: true,
    circleStyle: "filled",
    circleColor: "var(--kind-social)",
    iconColor: "white",
    blockBg: "var(--kind-social-bg)",
    dashedBorder: false,
  },
  family: {
    label: "友人・家族との時間",
    icon: Heart,
    hasCircle: true,
    circleStyle: "filled",
    circleColor: "var(--kind-social)",
    iconColor: "white",
    blockBg: "var(--kind-social-bg)",
    dashedBorder: false,
  },
};

const NON_FIXED_APPEARANCE: Record<Exclude<ItemKind, "fixed">, ItemAppearance> = {
  sleep: {
    label: "睡眠",
    icon: Moon,
    hasCircle: false,
    circleStyle: "filled",
    circleColor: "var(--kind-sleep)",
    iconColor: "var(--kind-sleep)",
    blockBg: "transparent",
    dashedBorder: false,
  },
  travel: {
    label: "移動",
    icon: TrainFront,
    hasCircle: false,
    circleStyle: "filled",
    circleColor: "var(--kind-travel)",
    iconColor: "var(--kind-travel)",
    blockBg: "transparent",
    dashedBorder: true,
  },
  task: {
    label: "タスク",
    icon: CircleCheck,
    hasCircle: true,
    circleStyle: "filled",
    circleColor: "var(--kind-task)",
    iconColor: "white",
    blockBg: "var(--kind-task-bg)",
    dashedBorder: false,
  },
  buffer: {
    // design-spec.md 4章：内部の「バッファ」は画面上「余白」と表示する
    label: "余白",
    icon: Hourglass,
    hasCircle: true,
    circleStyle: "ring",
    circleColor: "var(--kind-buffer)",
    // design-spec.md 5.4・9.3：塗りがないため、アイコンは --brand-purple にする
    iconColor: "var(--brand-purple)",
    blockBg: "var(--kind-buffer-bg)",
    dashedBorder: true,
  },
  free: {
    label: "自由時間",
    icon: Coffee,
    hasCircle: true,
    circleStyle: "filled",
    circleColor: "var(--kind-free)",
    iconColor: "white",
    blockBg: "var(--kind-free-bg)",
    dashedBorder: false,
  },
};

/** kind（fixed のときは fixedCategory も）から見た目を引く */
export function getItemAppearance(kind: ItemKind, fixedCategory?: FixedCategory | null): ItemAppearance {
  if (kind === "fixed") {
    if (!fixedCategory) {
      throw new Error("kind が fixed の項目には fixedCategory が必要です");
    }
    return FIXED_APPEARANCE[fixedCategory];
  }
  return NON_FIXED_APPEARANCE[kind];
}

/** 移動のアイコンは移動手段で決める（design-spec.md 9.7） */
export function getTravelIcon(mode: TravelMode): LucideIcon {
  switch (mode) {
    case "walk":
      return Footprints;
    case "bus":
      return Bus;
    case "bike":
      return Bike;
    case "train":
    case "walk_train":
      return TrainFront;
  }
}

/** 移動手段の表示名（design-spec.md 9.9。「移動 50分（徒歩＋電車）」のように使う） */
export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  walk_train: "徒歩＋電車",
  walk: "徒歩",
  train: "電車",
  bus: "バス",
  bike: "自転車",
};

// ---------- 締切バッジ（design-spec.md 5.4・9.3・9.6。赤は使わない） ----------
export const DEADLINE_BADGE_BG = "var(--deadline-bg)";
export const DEADLINE_BADGE_TEXT_COLOR = "var(--deadline-fg)";

/** "締切 10/9" */
export function formatDeadlineBadge(deadlineAt: string): string {
  return `締切 ${formatMonthDay(deadlineAt)}`;
}

// ---------- 航路プラン（design-spec.md 4章） ----------
export const PLAN_STYLE_LABELS: Record<PlanStyle, string> = {
  intensive: "集中の航路",
  balanced: "バランスの航路",
  relaxed: "ゆとりの航路",
};

// ---------- 画面の言葉づかい（design-spec.md 4章） ----------
export const SCREEN_LABELS = {
  today: "今日の航路",
  calendar: "航海図",
  replan: "AIとの対話",
  replanButton: "航路を調整する",
  buffer: "余白",
  currentTimeLine: "現在地",
  // 現在時刻を含む予定がないときに、次に始まる予定の行に付ける（design-spec.md 9.8）
  nextRoute: "次の航路",
  goal: "目的地",
  interview: "航海の準備（目的地を決める）",
} as const;

/** タブバー（design-spec.md 5.2。mock-spec.md 1.2 の表を置き換え） */
export const TAB_ITEMS: { href: "/today" | "/calendar" | "/replan" | "/settings"; label: string; icon: LucideIcon }[] = [
  { href: "/today", label: "ホーム", icon: House },
  { href: "/calendar", label: "航海図", icon: MapIcon },
  { href: "/replan", label: "AIと対話", icon: MessageCircle },
  { href: "/settings", label: "設定", icon: Settings },
];

/** ヘッダーの挨拶文（design-spec.md 4章）。demo_now などのISO日時からJSTの時間帯で出し分ける */
export function getGreeting(isoStr: string): string {
  const hour = getJstHour(isoStr);
  if (hour >= 5 && hour < 11) return "おはよう、今日もよい航路を。";
  if (hour >= 11 && hour < 17) return "こんにちは、今日の航路は順調ですか。";
  return "おつかれさま、今日の航路をふり返ろう。";
}

// ---------- 目標時間3案（mock-spec.md 5.8・10.2） ----------
export const GOAL_PLAN_STYLE_LABELS: Record<GoalPlanStyle, string> = {
  intensive: "短期集中型",
  balanced: "バランス標準型",
  paced: "マイペース型",
};

/** 目標時間3案の負荷のバッジ */
export const LOAD_LABELS: Record<Level, string> = {
  high: "負荷 高め",
  medium: "負荷 ふつう",
  low: "負荷 軽め",
};

/** 3案の選択を送ったときのユーザーの吹き出し「『バランス標準型』週6時間にします」（10.2章） */
export function formatGoalSelectionMessage(style: GoalPlanStyle, hoursPerWeek: number): string {
  return `『${GOAL_PLAN_STYLE_LABELS[style]}』週${hoursPerWeek}時間にします`;
}

/** /plans の3案の切り替え（セグメント）に使う短い表示名 */
export const PLAN_STYLE_SHORT_LABELS: Record<PlanStyle, string> = {
  intensive: "集中",
  balanced: "バランス",
  relaxed: "ゆとり",
};

// ---------- オンボーディング（/login・/interview・/plans）の文言（design-spec.md 1章・4章・6章） ----------
export const ONBOARDING_LABELS = {
  tagline: "まだ決まっていない未来を、今の自分から航海する。",
  taglineEn: "Navigate your uncertain future.",
  start: "はじめる",
  interviewTitle: "航海の準備",
  plansTitle: "航路プランを選ぶ",
  chooseCandidate: "これにする",
  confirmCandidate: "この内容で確定",
  confirmGoal: "確定する",
  generatePlans: "スケジュール作成",
  generating: "スケジュールを作成しています…",
  selectPlan: "このプランにする",
  noPlans: "航路プランはまだありません",
  backToInterview: "航海の準備へ",
  inputWhileChoosing: "上の案から選んでください",
  inputWhileConfirming: "確定ボタンを押してください",
} as const;

// ---------- 通常利用（/today・/replan）の文言（design-spec.md 4章・6章・9.4、mock-spec.md 2.4・2.5） ----------
export const TODAY_LABELS = {
  taskTotal: "タスク",
  bufferTotal: SCREEN_LABELS.buffer,
  freeTotal: "自由時間",
  noPlan: "この日の計画はまだありません",
  noPlanHint: "固定の予定だけを表示しています",
  updated: "計画を更新しました",
} as const;

export const REPLAN_LABELS = {
  prompt: "予定の変更や、今の状態を教えてください",
  advancedClock: "デモのため、時刻を18:00に進めました",
  adjusting: "航路を調整しています…",
  changesTitle: "変更点",
  unchanged: (count: number) => `変更なし ${count}件`,
  otherDaysTitle: "ほかの日への影響",
  compareToggle: "変更前と変更後を並べて見る",
  before: "変更前",
  after: "変更後",
  none: "なし",
  accept: "この計画にする",
  cancel: "やめておく",
  acceptError: "計画を更新できませんでした。",
  sendError: "送信できませんでした。",
} as const;

/** /replan のクイックリプライ（mock-spec.md 2.5） */
export const REPLAN_QUICK_REPLIES = [
  "今日は疲れた",
  "18時から予定が入った",
  "このタスクを明日に回したい",
  "今から30分だけ何かやりたい",
];

/** 再計画の変更の種類（ReplanChange の change_type）ごとの表示名とアイコン */
export const CHANGE_TYPE_LABELS: Record<ReplanChange["change_type"], { label: string; icon: LucideIcon }> = {
  moved: { label: "移動", icon: ArrowRightLeft },
  shortened: { label: "短縮", icon: Timer },
  replaced: { label: "入れ替え", icon: Repeat },
  removed: { label: "削除", icon: CircleMinus },
  added: { label: "追加", icon: CirclePlus },
};

/** デモ時刻のチップ「デモ 07:00」（design-spec.md 9.4） */
export function formatDemoChip(isoStr: string): string {
  return `デモ ${formatTime(isoStr)}`;
}

// ---------- 航海図（/calendar）の文言（design-spec.md 4章・6章、mock-spec.md 2.6） ----------
export type CalendarViewMode = "month" | "week" | "day";

/** 月／週／日 の切り替え（この順に並べる。初期表示は週） */
export const CALENDAR_VIEW_LABELS: Record<CalendarViewMode, string> = {
  month: "月",
  week: "週",
  day: "日",
};

export const CALENDAR_LABELS = {
  title: "あなたの航海図",
  prev: { month: "前の月", week: "前の週", day: "前の日" } satisfies Record<CalendarViewMode, string>,
  next: { month: "次の月", week: "次の週", day: "次の日" } satisfies Record<CalendarViewMode, string>,
  noMonthData: "この月のデータはありません",
  noWeekData: "この週のデータはありません",
  noWeekPlan: "この週の計画はまだありません",
  noPlanHint: TODAY_LABELS.noPlanHint,
  noDayPlan: TODAY_LABELS.noPlan,
  conditionTitle: "今週のコンディション",
  hasPlanLegend: "計画あり",
  deadlineLegend: "締切",
} as const;

/**
 * 週表示の凡例（mock-spec.md 10.22、design-spec.md 9.12）。色・アイコンはタイムラインと同じ見た目から引く。
 * 固定予定（授業／バイト）と移動（電車／徒歩）は、ブロックに出るアイコンが複数あるので並べて出す
 */
export const WEEK_LEGEND_ITEMS: { label: string; appearance: ItemAppearance; icons: LucideIcon[] }[] = [
  { label: "タスク", appearance: NON_FIXED_APPEARANCE.task, icons: [NON_FIXED_APPEARANCE.task.icon] },
  { label: "固定予定", appearance: FIXED_APPEARANCE.class, icons: [School, Briefcase] },
  { label: "食事", appearance: FIXED_APPEARANCE.meal, icons: [FIXED_APPEARANCE.meal.icon] },
  { label: "大切な人との時間", appearance: FIXED_APPEARANCE.social, icons: [FIXED_APPEARANCE.social.icon] },
  { label: "移動", appearance: NON_FIXED_APPEARANCE.travel, icons: [TrainFront, Footprints] },
  { label: SCREEN_LABELS.buffer, appearance: NON_FIXED_APPEARANCE.buffer, icons: [NON_FIXED_APPEARANCE.buffer.icon] },
  { label: "自由時間", appearance: NON_FIXED_APPEARANCE.free, icons: [NON_FIXED_APPEARANCE.free.icon] },
];

/** 分の表示「45分」「1時間15分」「2時間」 */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/**
 * 週表示の列のボタンの読み上げ「10月7日（水）　タスク3件・余白45分・締切なし。予定を見る」。
 * ブロックに文字を出さないため、その日の概要を読み上げで伝える（mock-spec.md 10.22）
 */
export function formatWeekColumnLabel(
  dateLong: string,
  summary: { taskCount: number; bufferMinutes: number; deadlineCount: number },
): string {
  const buffer =
    summary.bufferMinutes > 0
      ? `${SCREEN_LABELS.buffer}${formatMinutes(summary.bufferMinutes)}`
      : `${SCREEN_LABELS.buffer}なし`;
  const deadline = summary.deadlineCount > 0 ? `締切${summary.deadlineCount}件` : "締切なし";
  return `${dateLong}　タスク${summary.taskCount}件・${buffer}・${deadline}。予定を見る`;
}

/** 月表示の小さな点の色（MonthView の kinds。design-spec.md 2.3 の丸印の色） */
export const MONTH_KIND_DOT_COLORS: Record<MonthView["days"][number]["kinds"][number], string> = {
  class: "var(--kind-fixed)",
  work: "var(--kind-fixed)",
  task: "var(--kind-task)",
  social: "var(--kind-social)",
};

// ---------- 設定（/settings）の文言（mock-spec.md 2.7） ----------
export const SETTINGS_LABELS = {
  // タブバーの「設定」と同じ
  title: "設定",
  rhythmTitle: "生活リズム",
  sleep: "睡眠",
  dailyWorkLimit: "1日の作業上限",
  minBuffer: `${SCREEN_LABELS.buffer}の最低量`,
  locationsTitle: "よく行く場所",
  noLocations: "登録されている場所はありません",
  travelTitle: "移動時間",
  noTravelTimes: "登録されている移動時間はありません",
  goalTitle: SCREEN_LABELS.goal,
  deadline: "期限",
  // design-spec.md 4章：目標（Goal）は画面上「目的地」（mock-spec.md 10.23）
  consultGoal: `新しい${SCREEN_LABELS.goal}を相談する`,
  demoTitle: "デモ用",
  demoClock: "デモ時刻の切り替え",
  demoClockError: "デモ時刻を切り替えられませんでした。",
  reset: "モックをリセット",
  resetting: "リセットしています…",
  resetError: "リセットできませんでした。",
} as const;

/** デモ時刻の切り替えの選択肢（mock-spec.md 2.7） */
export const DEMO_CLOCK_TIMES = ["07:00", "18:00"] as const;

/** 「0:00〜7:30」（UserPreference の "HH:MM" から。時の先頭の0は付けない） */
export function formatClockRange(start: string, end: string): string {
  const trim = (hm: string) => hm.replace(/^0(\d)/, "$1");
  return `${trim(start)}〜${trim(end)}`;
}

/** 移動時間の一覧の1行「自宅 → 架空大学 つばさキャンパス」 */
export function formatRoute(fromName: string, toName: string): string {
  return `${fromName} → ${toName}`;
}

/** 「50分（徒歩＋電車）」（design-spec.md 9.9 の手段の表示名） */
export function formatTravelDuration(minutes: number, mode: TravelMode): string {
  return `${minutes}分（${TRAVEL_MODE_LABELS[mode]}）`;
}

/** 目標の週の時間「週6時間」 */
export function formatHoursPerWeek(hours: number): string {
  return `週${hours}時間`;
}

/** 時間数の表示「3.5時間」（小数第1位まで。/plans の比較表と /today の合計で共用） */
export function formatHours(hours: number): string {
  return `${Math.round(hours * 10) / 10}時間`;
}
