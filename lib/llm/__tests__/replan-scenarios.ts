import type { ReplanTaskOption } from "@/lib/llm/replan-keywords";
import type { ConvertedReplanIntent } from "@/lib/server/replan-intent";

// 再計画の発言 → 意図のシナリオ表（docs/scenarios/replan-chat.md「6. 口語」）。
// キーワードのテスト（replan-keywords.test.ts）と LLM の live テスト（replan-intent.live.test.ts）で共通に使う

// 10/5（月）18:00。今日の now 以降のタスク項目
export const SCENARIO_DATE = "2026-10-05";
export const SCENARIO_NOW = "2026-10-05T18:00:00+09:00";
export const SCENARIO_TASKS: ReplanTaskOption[] = [
  {
    task_id: "t-listening",
    title: "TOEICリスニング演習",
    start_at: "2026-10-05T18:00:00+09:00",
    end_at: "2026-10-05T19:00:00+09:00",
  },
  {
    task_id: "t-words",
    title: "TOEIC単語",
    start_at: "2026-10-05T19:15:00+09:00",
    end_at: "2026-10-05T19:45:00+09:00",
  },
  {
    task_id: "t-es",
    title: "ES作成（企業A）",
    start_at: "2026-10-05T20:00:00+09:00",
    end_at: "2026-10-05T21:00:00+09:00",
  },
];

const ALL = ["t-listening", "t-words", "t-es"];

export type ScenarioExpect =
  | { type: "state_change"; fatigue?: "high" | "medium" } // fatigue を書かない行は null でなければよい
  | { type: "new_fixed_event"; start: string; end: string } // "HH:MM"
  | { type: "task_change"; postpone: string[] }
  | { type: "unknown" };

export type ScenarioRow = {
  no: number;
  text: string;
  expect: ScenarioExpect;
  keyword: boolean; // キーワードで当てるか
};

const state = (fatigue?: "high" | "medium"): ScenarioExpect => ({ type: "state_change", fatigue });
const event = (start: string, end: string): ScenarioExpect => ({
  type: "new_fixed_event",
  start,
  end,
});
const postpone = (...ids: string[]): ScenarioExpect => ({ type: "task_change", postpone: ids });
const unknown: ScenarioExpect = { type: "unknown" };

export const SCENARIO_ROWS: ScenarioRow[] = [
  { no: 1, text: "今日は疲れた", expect: state("high"), keyword: true },
  { no: 2, text: "ガチでだるい", expect: state(), keyword: true },
  { no: 3, text: "眠すぎ", expect: state(), keyword: true },
  { no: 4, text: "ねむ", expect: state(), keyword: true },
  { no: 5, text: "頭回らん", expect: state("medium"), keyword: true },
  { no: 6, text: "疲労やばい", expect: state(), keyword: true },
  { no: 7, text: "やる気ゼロ", expect: state("medium"), keyword: true },
  { no: 8, text: "集中続かない", expect: state("medium"), keyword: true },
  { no: 9, text: "集中できひん", expect: state("medium"), keyword: true },
  // キーワードでは state_change になる（否定形は扱わない。既知の限界）
  { no: 10, text: "だるくない、元気", expect: unknown, keyword: false },
  { no: 11, text: "今日は頑張れそう", expect: unknown, keyword: true },
  { no: 12, text: "やる気出てきた", expect: unknown, keyword: true },
  { no: 13, text: "20時からバイト入った", expect: event("20:00", "21:00"), keyword: true },
  { no: 14, text: "20時から飲み会", expect: event("20:00", "21:00"), keyword: true },
  { no: 15, text: "20:00から会議", expect: event("20:00", "21:00"), keyword: true },
  { no: 16, text: "夜8時から約束", expect: event("20:00", "21:00"), keyword: true },
  { no: 17, text: "8時半から用事", expect: event("20:30", "21:30"), keyword: true },
  { no: 18, text: "20時から1時間半バイト", expect: event("20:00", "21:30"), keyword: true },
  { no: 19, text: "20時〜22時バイト", expect: event("20:00", "22:00"), keyword: true },
  { no: 20, text: "明日の10時から面接", expect: unknown, keyword: true },
  { no: 21, text: "今日はもう勉強したくない", expect: postpone(...ALL), keyword: true },
  { no: 22, text: "勉強やりたくない", expect: postpone(...ALL), keyword: true },
  { no: 23, text: "今日はもうええわ", expect: postpone(...ALL), keyword: true },
  { no: 24, text: "もう無理ぽ", expect: postpone(...ALL), keyword: true },
  { no: 25, text: "ESやりたくない", expect: postpone("t-es"), keyword: true },
  { no: 26, text: "ESは明日でいいや", expect: postpone("t-es"), keyword: true },
  { no: 27, text: "リスニング明日に回して", expect: postpone("t-listening"), keyword: true },
  { no: 28, text: "ワンチャン明日でよくね？", expect: postpone(...ALL), keyword: true },
  {
    no: 29,
    text: "疲れたから今日はもう勉強したくない",
    expect: postpone(...ALL),
    keyword: true,
  },
  { no: 30, text: "明日の天気は？", expect: unknown, keyword: true },
];

const hhmm = (iso: string) => iso.slice(11, 16);

// 変換後の意図を、表の期待と同じ書き方の文にする（違いの一覧に出す）
export function describeResult(result: ConvertedReplanIntent): string {
  if (result.type === "unknown") return "unknown";
  const { intent } = result;
  switch (intent.type) {
    case "state_change":
      return `state_change fatigue=${intent.fatigue}`;
    case "new_fixed_event":
      return `new_fixed_event ${intent.new_fixed_events
        .map(
          (e) =>
            `${hhmm(e.start_at)}–${e.end_at.startsWith(SCENARIO_DATE) ? hhmm(e.end_at) : "24:00"}`,
        )
        .join(", ")}`;
    case "task_change":
      return `task_change ${intent.task_changes.map((c) => `${c.task_id}:${c.action}`).join(", ")}`;
    default:
      return intent.type;
  }
}

export function describeExpect(expect: ScenarioExpect): string {
  switch (expect.type) {
    case "state_change":
      return `state_change fatigue=${expect.fatigue ?? "(null 以外)"}`;
    case "new_fixed_event":
      return `new_fixed_event ${expect.start}–${expect.end}`;
    case "task_change":
      return `task_change ${expect.postpone.map((id) => `${id}:postpone`).join(", ")}`;
    case "unknown":
      return "unknown";
  }
}

// 期待どおりなら true。checkFatigueLevel が false なら、state_change の fatigue は null でなければよい
// （キーワードは fatigue をいつも "high" にするため。12.3.2）
export function matchesExpect(
  result: ConvertedReplanIntent,
  expect: ScenarioExpect,
  checkFatigueLevel: boolean,
): boolean {
  if (result.type === "unknown") return expect.type === "unknown";
  const { intent } = result;
  if (intent.type !== expect.type) return false;
  switch (expect.type) {
    case "state_change":
      if (intent.fatigue === null) return false;
      return (
        !checkFatigueLevel || expect.fatigue === undefined || intent.fatigue === expect.fatigue
      );
    case "new_fixed_event":
      return (
        intent.new_fixed_events.length === 1 &&
        intent.new_fixed_events[0].start_at === `${SCENARIO_DATE}T${expect.start}:00+09:00` &&
        intent.new_fixed_events[0].end_at === `${SCENARIO_DATE}T${expect.end}:00+09:00`
      );
    case "task_change": {
      const got = intent.task_changes.map((c) => `${c.task_id}:${c.action}`).sort();
      const want = expect.postpone.map((id) => `${id}:postpone`).sort();
      return got.length === want.length && got.every((v, i) => v === want[i]);
    }
    default:
      return true;
  }
}
