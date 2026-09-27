import {
  GoalPlanStyleSchema,
  type FixedEvent,
  type GoalPlanStyle,
  type GoalTimeCandidate,
  type Level,
} from "@/lib/schemas";
import { diffMinutes, getWeekdayJa, toDateStr } from "@/lib/datetime";
import { GOAL_PLAN_STYLE_LABELS } from "@/lib/labels";
import { isLlmEnabled, LlmError } from "@/lib/llm/client";
import { generateGoalCandidateTextsByLlm } from "@/lib/llm/goal-candidates";
import { computeGoalCandidateHours } from "@/lib/planning/goal-candidates";
import { mainMinutesFor } from "./goal-task-template";
import { taskNameOf } from "./interview-summary";
import type { InterviewSlots } from "./repositories/interview";

// 目標時間3案（backend.md 7.2）。時間はルールで計算し（補正 C-14）、文章は LLM（失敗時・LLM_MODE=off はテンプレート。7.2.3）

type CandidateTexts = Pick<GoalTimeCandidate, "characteristics" | "merit" | "caution" | "reason">;
type CandidateHours = Record<GoalPlanStyle, number>;

// intensive・balanced・paced の順（LLM の出力の順と同じ）
const STYLES = GoalPlanStyleSchema.options;

const EXPECTED_LOAD: Record<GoalPlanStyle, Level> = { intensive: "high", balanced: "medium", paced: "low" };

// 7.2.3 のテンプレート（{name} は task_name）
export function templateCandidateTexts(style: GoalPlanStyle, name: string): CandidateTexts {
  switch (style) {
    case "intensive":
      return {
        characteristics: "毎日まとまった時間を確保",
        merit: "目標に余裕を持って届きやすい",
        caution: "忙しい曜日は負担が大きくなりやすい",
        reason: `${name}を短期間で進めたい場合の目安です`,
      };
    case "balanced":
      return {
        characteristics: "週5日ほど、無理のない量で継続",
        merit: "ほかの予定と両立しやすい",
        caution: "苦手な分野は早めに重点化が必要",
        reason: `${name}を標準的なペースで進める目安です`,
      };
    case "paced":
      return {
        characteristics: "空き時間に少しずつ",
        merit: "負担が小さく続けやすい",
        caution: "目標には追加の時間が必要になる可能性があります",
        reason: "忙しい時期でも途切れずに続けたい場合の目安です",
      };
  }
}

const MAX_TEXT_LENGTH = 60;

// 文中の「◯時間」「◯h」の数値（全角数字・小数点も半角に直す）
const HOURS_PATTERN = /([0-9０-９]+(?:[.．][0-9０-９]+)?)\s*(?:時間|[hH])/g;

function toHalfWidth(text: string): string {
  return text.replace(/[０-９．]/g, (c) => (c === "．" ? "." : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

// 1つの文が使えるか：空でない・60文字以内・時間の数値がすべてその案の時間と同じ
function isValidText(text: string, hours: number): boolean {
  const trimmed = text.trim();
  const length = [...trimmed].length;
  if (length === 0 || length > MAX_TEXT_LENGTH) return false;
  for (const match of trimmed.matchAll(HOURS_PATTERN)) {
    if (parseFloat(toHalfWidth(match[1])) !== hours) return false;
  }
  return true;
}

// LLM の文章を検証し、使えない案だけテンプレートに置き換える（7.2.3）。3件でなければ全部テンプレート
export function mergeCandidateTexts(
  hours: CandidateHours,
  llmTexts: readonly CandidateTexts[],
  name: string,
): Record<GoalPlanStyle, CandidateTexts> {
  const result = {} as Record<GoalPlanStyle, CandidateTexts>;
  STYLES.forEach((style, i) => {
    const texts = llmTexts.length === STYLES.length ? llmTexts[i] : null;
    const valid =
      texts !== null &&
      [texts.characteristics, texts.merit, texts.caution, texts.reason].every((t) => isValidText(t, hours[style]));
    result[style] = valid
      ? {
          characteristics: texts.characteristics.trim(),
          merit: texts.merit.trim(),
          caution: texts.caution.trim(),
          reason: texts.reason.trim(),
        }
      : templateCandidateTexts(style, name);
  });
  return result;
}

const WEEKDAY_ORDER = ["月", "火", "水", "木", "金", "土", "日"];
// 一言にまとめる固定予定のカテゴリと呼び方（この順に並べる）
const SUMMARY_CATEGORIES = [
  { category: "work", label: "バイト" },
  { category: "class", label: "授業" },
] as const;

// 曜日ごとの固定予定の一言（7.2.3）。例：「火・土はバイト、月・火・水・木・金は授業」。該当する予定がなければ ""
export function summarizeFixedEvents(fixedEvents: readonly FixedEvent[]): string {
  const parts: string[] = [];
  for (const { category, label } of SUMMARY_CATEGORIES) {
    const days = new Set(
      fixedEvents.filter((e) => e.category === category).map((e) => getWeekdayJa(toDateStr(e.start_at))),
    );
    if (days.size === 0) continue;
    const ordered = WEEKDAY_ORDER.filter((d) => days.has(d));
    parts.push(`${ordered.join("・")}は${label}`);
  }
  return parts.join("、");
}

// 期限までの週数（7.2.1）。期限なしは null
function weeksUntil(deadline: string | null, today: string): number | null {
  if (deadline === null) return null;
  return Math.ceil(diffMinutes(today, deadline) / (60 * 24) / 7);
}

// 3案の文章。LLM が使えれば LLM（検証して、だめな案だけテンプレート）、LlmError か無効なら全部テンプレート
async function resolveCandidateTexts(
  hours: CandidateHours,
  slots: InterviewSlots,
  name: string,
  fixedEvents: readonly FixedEvent[],
): Promise<Record<GoalPlanStyle, CandidateTexts>> {
  if (isLlmEnabled()) {
    try {
      const llm = await generateGoalCandidateTextsByLlm({
        hours,
        task_name: name,
        current_status: slots.current_status,
        conditions: slots.conditions,
        deadline: slots.deadline,
        fixed_events_summary: summarizeFixedEvents(fixedEvents),
      });
      return mergeCandidateTexts(hours, llm.candidates, name);
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
    }
  }
  return mergeCandidateTexts(hours, [], name);
}

// 目標時間3案（7.2）。slots はステップ4までの回答を反映したもの、today は YYYY-MM-DD、
// weeklyFreeMinutes は now〜日曜の空きの合計分（7.2.2 の上限。null なら上限をかけない）、fixedEvents は今週に展開した固定予定
export async function buildGoalCandidates(args: {
  slots: InterviewSlots;
  today: string;
  weeklyFreeMinutes: number | null;
  fixedEvents: readonly FixedEvent[];
}): Promise<GoalTimeCandidate[]> {
  const { slots, today } = args;
  const category = slots.category ?? "その他";
  const hours = computeGoalCandidateHours({
    category,
    deadline: slots.deadline,
    today,
    explicit_hours_per_week: slots.explicit_hours_per_week,
    frequency_per_week: slots.frequency_per_week,
    main_minutes: mainMinutesFor(category),
    weekly_free_minutes: args.weeklyFreeMinutes ?? Number.POSITIVE_INFINITY,
  });
  const periodWeeks = weeksUntil(slots.deadline, today);
  const texts = await resolveCandidateTexts(hours, slots, taskNameOf(slots), args.fixedEvents);

  return STYLES.map((style) => ({
    style,
    label: GOAL_PLAN_STYLE_LABELS[style],
    hours_per_week: hours[style],
    expected_load: EXPECTED_LOAD[style],
    period_weeks: periodWeeks,
    ...texts[style],
  }));
}
