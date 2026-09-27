import type { z } from "zod";
import type { ReplanIntentLlmSchema } from "@/lib/schemas";

// 再計画の意図をキーワードで取り出す（plans-replan.md 12.3.2）。LLM_MODE=off と、LLM が失敗したときに使う。
// 出力は LLM と同じ ReplanIntentLlmSchema の形。検証・変換（task_id の確認・時刻を日時にする）は
// lib/server/replan-intent.ts の toReplanningIntent() が行う

export type ReplanIntentLlm = z.infer<typeof ReplanIntentLlmSchema>;

// 今日の now 以降のタスク項目（意図の取り出しの入力。12.3.1）
export type ReplanTaskOption = { task_id: string; title: string; start_at: string; end_at: string };

const FATIGUE = /疲れ|つかれ|しんど|だる|眠い|ねむい/;
const START = /(\d{1,2})時(半)?から/;
const EVENT_WORD = /予定|用事|約束|バイト|会議/;
const END = /(\d{1,2})時(半)?まで/;
const HOURS = /(\d+)時間(半)?/;
const GIVE_UP = /勉強したくない|もう(やりたくない|無理)/;
const TO_TOMORROW = /明日に(回|まわ)/;

const pad = (n: number) => String(n).padStart(2, "0");
const toTime = (hour: string, half: string | undefined) =>
  `${pad(Number(hour))}:${half ? "30" : "00"}`;

function empty(type: ReplanIntentLlm["type"]): ReplanIntentLlm {
  return { type, fatigue: null, task_changes: [], new_fixed_events: [], preference_changes: [] };
}

// 同じタスクが今日に2回あっても、task_changes には1回だけ入れる
function uniqueTaskIds(tasks: readonly ReplanTaskOption[]): string[] {
  return Array.from(new Set(tasks.map((t) => t.task_id)));
}

// 発言 → 意図。12.3.2 の表を上から順に調べ、最初に当てはまったものを使う
export function extractReplanIntentByKeywords(
  text: string,
  todayTasks: readonly ReplanTaskOption[],
): ReplanIntentLlm {
  // 全角の数字（「２０時」）も半角として読む
  const t = text.normalize("NFKC");

  if (FATIGUE.test(t)) return { ...empty("state_change"), fatigue: "high" };

  const start = START.exec(t);
  if (start && EVENT_WORD.test(t)) {
    const startTime = toTime(start[1], start[2]);
    let endTime: string | null = null;
    const end = END.exec(t);
    const hours = HOURS.exec(t);
    if (end) {
      endTime = toTime(end[1], end[2]);
    } else if (hours) {
      const minutes =
        Number(start[1]) * 60 + (start[2] ? 30 : 0) + Number(hours[1]) * 60 + (hours[2] ? 30 : 0);
      endTime = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    }
    return {
      ...empty("new_fixed_event"),
      new_fixed_events: [{ title: null, start_time: startTime, end_time: endTime }],
    };
  }

  if (GIVE_UP.test(t)) {
    return {
      ...empty("task_change"),
      task_changes: uniqueTaskIds(todayTasks).map((task_id) => ({
        task_id,
        action: "postpone" as const,
      })),
    };
  }

  if (TO_TOMORROW.test(t)) {
    const named = todayTasks.filter((task) => t.includes(task.title.normalize("NFKC")));
    if (named.length > 0) {
      return {
        ...empty("task_change"),
        task_changes: uniqueTaskIds(named).map((task_id) => ({
          task_id,
          action: "postpone" as const,
        })),
      };
    }
  }

  return empty("unknown");
}
