import type { z } from "zod";
import type { ReplanIntentLlmSchema } from "@/lib/schemas";
import { formatTime } from "@/lib/datetime";

// 再計画の意図をキーワードで取り出す（plans-replan.md 12.3.2）。LLM_MODE=off と、LLM が失敗したときに使う。
// 出力は LLM と同じ ReplanIntentLlmSchema の形。検証・変換（task_id の確認・時刻を日時にする）は
// lib/server/replan-intent.ts の toReplanningIntent() が行う

export type ReplanIntentLlm = z.infer<typeof ReplanIntentLlmSchema>;

// 今日の now 以降のタスク項目（意図の取り出しの入力。12.3.1）
export type ReplanTaskOption = { task_id: string; title: string; start_at: string; end_at: string };

// タスクを指定して明日に回す・やめる（発言にタスクのキーがあるとき）
const TASK_NAMED = /明日(に(回|まわ)|で(いい|よく|ええ))|明日やる|(やりたく|したく)ない/;
// 今日のタスクを全部やめる（発言にタスクのキーがないとき）
const GIVE_UP_ALL =
  /勉強(したく|やりたく)ない|もう(やりたくない|無理|ええ|いいや)|明日で(いい|よく|ええ)/;
// 疲れ・気分の落ち込み。「やる気」だけ（「やる気が出てきた」）や「頑張れそう」は当てない
const FATIGUE =
  /疲|つかれ|しんど|だる|眠|ねむ|やる気(が)?(出|で)ない|やる気ない|やる気が起きない|やる気(ゼロ|0|なし|皆無)|頑張れな|がんばれな|集中(でき|続か|もた)(な|ひん|ん)|頭(が)?回ら/;
const EVENT_WORD =
  /予定|用事|約束|バイト|会議|飲み|ご飯|ごはん|面接|授業|ゼミ|病院|打ち合わせ|ミーティング|mtg|説明会/i;
const TOMORROW = /明日/;
// 開始：「HH:MM」か「N時(半|M分)?」の後に「から」か「〜・~」（区切りは読まずに残す。終了の「〜」で使う）
const START = /(\d{1,2})(?::(\d{2})|時(?:(半)|(\d{1,2})分)?)(?=\s*(?:から|[〜~]))/;
// 終了：「〜HH:MM・〜N時(半)?」か「HH:MMまで・N時(半)?まで」
const END = /[〜~]\s*(\d{1,2})(?::(\d{2})|時(半)?)|(\d{1,2})(?::(\d{2})|時(半)?)\s*まで/;
// 長さ：「N時間(半)?」「N分」（「22時30分」の「30分」は長さにしない）
const HOURS = /(\d+)時間(半)?/;
const MINUTES = /(?<![時\d])(\d+)分/;
const EVENING = /夜|晩|午後/;
const MORNING = /朝|午前/;

// タイトルを区切る一般的な語（キーにしない）
const GENERIC_WORDS = /作成|演習|課題|勉強|練習/g;

const pad = (n: number) => String(n).padStart(2, "0");
const toTime = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

function empty(type: ReplanIntentLlm["type"]): ReplanIntentLlm {
  return { type, fatigue: null, task_changes: [], new_fixed_events: [], preference_changes: [] };
}

// 同じタスクが今日に2回あっても、task_changes には1回だけ入れる
function postpone(tasks: readonly ReplanTaskOption[]): ReplanIntentLlm {
  return {
    ...empty("task_change"),
    task_changes: Array.from(new Set(tasks.map((t) => t.task_id))).map((task_id) => ({
      task_id,
      action: "postpone" as const,
    })),
  };
}

// タイトル → 発言と比べるキー（NFKC・小文字）。一般的な語・括弧・空白・「の」と、英数字 → 日本語の境目で分け、
// 2文字未満を捨てる。例：「ES作成（企業A）」→ es・企業a、「統計学の課題」→ 統計学
export function taskKeys(title: string): string[] {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(GENERIC_WORDS, " ")
    .split(/[\s()[\]「」【】の]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[^a-z0-9])/))
    .filter((key) => key.length >= 2);
}

// "HH:MM"・"N時(半)" の一致 → 0:00 からの分
function matchMinutes(hour: string, minute: string | undefined, half: string | undefined): number {
  return Number(hour) * 60 + (minute !== undefined ? Number(minute) : half ? 30 : 0);
}

// 発言から時刻の決まった予定を1つ読む。読めなければ null
function readFixedEvent(t: string, now: string | undefined): ReplanIntentLlm | null {
  if (TOMORROW.test(t) || !EVENT_WORD.test(t)) return null;
  const start = START.exec(t);
  if (!start) return null;

  let startMin = matchMinutes(start[1], start[2] ?? start[4], start[3]);
  // 午後の時刻に読みかえる：夜・晩・午後があり N < 12、または朝・午前がなく N ≤ 11 でその時刻が now より前
  let pm = false;
  if (startMin < 12 * 60) {
    if (EVENING.test(t)) pm = true;
    else if (!MORNING.test(t) && now !== undefined) {
      const [h, m] = formatTime(now).split(":").map(Number);
      pm = startMin < h * 60 + m;
    }
  }
  if (pm) startMin += 12 * 60;

  // 終了と長さは、開始の時刻より後ろから探す
  const rest = t.slice(start.index + start[0].length);
  let endTime: string | null = null;
  const end = END.exec(rest);
  if (end) {
    let endMin =
      end[1] !== undefined
        ? matchMinutes(end[1], end[2], end[3])
        : matchMinutes(end[4], end[5], end[6]);
    if (pm && endMin < 12 * 60) endMin += 12 * 60;
    endTime = toTime(endMin);
  } else {
    const hours = HOURS.exec(rest);
    const minutes = MINUTES.exec(rest);
    if (hours || minutes) {
      const length =
        (hours ? Number(hours[1]) * 60 + (hours[2] ? 30 : 0) : 0) +
        (minutes ? Number(minutes[1]) : 0);
      endTime = toTime(startMin + length);
    }
  }
  return {
    ...empty("new_fixed_event"),
    new_fixed_events: [{ title: null, start_time: toTime(startMin), end_time: endTime }],
  };
}

// 発言 → 意図。12.3.2 の表を上から順に調べ、最初に当てはまったものを使う。
// now（getNow() の値）は「8時から」を午後に読みかえるかどうかに使う
export function extractReplanIntentByKeywords(
  text: string,
  todayTasks: readonly ReplanTaskOption[],
  now?: string,
): ReplanIntentLlm {
  // 全角の数字・コロン（「２０：００」）も半角として読む
  const t = text.normalize("NFKC").toLowerCase();

  const named = todayTasks.filter((task) => taskKeys(task.title).some((key) => t.includes(key)));
  if (TASK_NAMED.test(t) && named.length > 0) return postpone(named);
  if (GIVE_UP_ALL.test(t) && named.length === 0) return postpone(todayTasks);

  if (FATIGUE.test(t)) return { ...empty("state_change"), fatigue: "high" };

  return readFixedEvent(t, now) ?? empty("unknown");
}
