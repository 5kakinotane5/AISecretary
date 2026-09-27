import type { z } from "zod";
import { ReplanningIntentSchema, type FixedEvent } from "@/lib/schemas";
import { atJstTime } from "@/lib/datetime";
import { isLlmEnabled, LlmError } from "@/lib/llm/client";
import {
  extractReplanIntentByKeywords,
  type ReplanIntentLlm,
  type ReplanTaskOption,
} from "@/lib/llm/replan-keywords";
import { extractReplanIntentByLlm } from "@/lib/llm/replan-intent";

// 意図（ReplanIntentLlmSchema の形）→ ReplanningIntent の変換・検証（plans-replan.md 12.3.1 の後半）。
// キーワード（lib/llm/replan-keywords.ts）と LLM（lib/llm/replan-intent.ts）で共通に使う

// lib/schemas.ts に型の export がないため、ここで作る（schemas.ts は変えない）
export type ReplanningIntent = z.infer<typeof ReplanningIntentSchema>;

// 終わりの時刻がないときの仮の長さ（補正 C-10）
export const PROVISIONAL_EVENT_MINUTES = 60;
// 仮置きしたときに要約に付ける一文（補正 C-10）
export const PROVISIONAL_END_NOTE = "終わりの時刻が分からないため、1時間で仮置きしました。";

export type ReplanIntentInput = {
  date: string; // 今日（YYYY-MM-DD）
  now: string; // getNow() の値
  todayTasks: readonly ReplanTaskOption[]; // 今日の now 以降のタスク項目
};

export type ConvertedReplanIntent =
  | { type: "unknown" }
  | {
      type: "ok";
      intent: ReplanningIntent;
      provisional_end: boolean; // 終わりの時刻を仮置きした予定がある（要約に PROVISIONAL_END_NOTE を付ける）
    };

const TIME = /^(\d{1,2}):(\d{2})$/;

// "HH:MM" → その日の0:00からの分。形が違えば null（24:00 は 1440）
function toMinutes(time: string): number | null {
  const m = TIME.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min >= 60 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toTime = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export function toReplanningIntent(
  llm: ReplanIntentLlm,
  input: ReplanIntentInput,
): ConvertedReplanIntent {
  if (llm.type === "unknown") return { type: "unknown" };

  // task_id が今日の now 以降のタスクにないものは捨てる
  const allowed = new Set(input.todayTasks.map((t) => t.task_id));
  const taskChanges = llm.task_changes.filter((c) => allowed.has(c.task_id));

  // 予定：時刻を今日の日時にする。終わりがなければ開始＋60分（仮置き）。
  // 開始が now より前・開始 ≥ 終了・終了が 24:00 を超える → 捨てる
  const nowMs = Date.parse(input.now);
  let provisionalEnd = false;
  const events: FixedEvent[] = [];
  for (const e of llm.new_fixed_events) {
    const start = toMinutes(e.start_time);
    if (start === null) continue;
    const provisional = e.end_time === null;
    const end = provisional ? start + PROVISIONAL_EVENT_MINUTES : toMinutes(e.end_time as string);
    if (end === null || start >= end || end > 24 * 60) continue;
    const startAt = atJstTime(input.date, toTime(start));
    if (Date.parse(startAt) < nowMs) continue;
    events.push({
      id: crypto.randomUUID(),
      title: e.title?.trim() || "予定",
      category: "other",
      location_id: null,
      start_at: startAt,
      end_at: atJstTime(input.date, toTime(end)),
      recurrence: null,
    });
    if (provisional) provisionalEnd = true;
  }

  // 捨てた結果、その type の中身が空 → unknown
  if (llm.type === "task_change" && taskChanges.length === 0) return { type: "unknown" };
  if (llm.type === "new_fixed_event" && events.length === 0) return { type: "unknown" };

  const intent = ReplanningIntentSchema.parse({
    type: llm.type,
    fatigue: llm.fatigue,
    task_changes: taskChanges,
    new_fixed_events: events,
    preference_changes: llm.preference_changes,
  });
  return { type: "ok", intent, provisional_end: provisionalEnd };
}

// 発言 → 意図（plans-replan.md 12.3）。LLM が有効なら LLM（12.3.1）、無効ならキーワード（12.3.2）。
// LLM が失敗したとき（LlmError、または結果の変換で例外が出たとき）はキーワードに戻す。
// LLM が unknown を返したときは失敗ではないので、そのまま unknown にする
export async function extractReplanIntent(
  text: string,
  input: ReplanIntentInput,
): Promise<ConvertedReplanIntent> {
  if (isLlmEnabled()) {
    try {
      const llm = await extractReplanIntentByLlm(text, input);
      return toReplanningIntent(llm, input);
    } catch (e) {
      if (!(e instanceof LlmError)) {
        // 変換で出た例外。内容（発言など）は出さず、種類だけ残す
        console.warn("[llm] replan_intent convert failed:", e instanceof Error ? e.name : typeof e);
      }
    }
  }
  return toReplanningIntent(extractReplanIntentByKeywords(text, input.todayTasks), input);
}
