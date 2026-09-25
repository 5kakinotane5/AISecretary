import type { ComponentType } from "react";
import {
  Briefcase,
  Bus,
  Bike,
  CalendarClock,
  CircleCheck,
  Coffee,
  Footprints,
  Heart,
  Hourglass,
  Moon,
  School,
  TrainFront,
  Utensils,
  type LucideProps,
} from "lucide-react";
import type { z } from "zod";
import type { FixedCategorySchema, ItemKindSchema, PlanStyleSchema, TravelModeSchema } from "./schemas";
import { formatMonthDay, getJstHour } from "./datetime";

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
  goal: "目的地",
  interview: "航海の準備（目的地を決める）",
} as const;

/** ヘッダーの挨拶文（design-spec.md 4章）。demo_now などのISO日時からJSTの時間帯で出し分ける */
export function getGreeting(isoStr: string): string {
  const hour = getJstHour(isoStr);
  if (hour >= 5 && hour < 11) return "おはよう、今日もよい航路を。";
  if (hour >= 11 && hour < 17) return "こんにちは、今日の航路は順調ですか。";
  return "おつかれさま、今日の航路をふり返ろう。";
}
