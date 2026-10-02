import {
  ReplanChatMessageLlmSchema,
  type FixedEvent,
  type ReplanChange,
  type ReplanProposal,
  type Task,
} from "@/lib/schemas";
import {
  addDays,
  diffMinutes,
  formatDateShort,
  formatMonthDay,
  formatTime,
  getWeekdayJa,
  getWeekStart,
  toDateStr,
} from "@/lib/datetime";
import { callStructured, LlmError } from "@/lib/llm/client";
import { computeReplanImpact } from "@/lib/replan-impact";

// 会話の再計画：説明の文章と数字の検査（replan-chat.md 12.12・12.13 ②、足した予定・タスク：replan-add.md 12.21）。
// 文章に出す数字は、コードが計算した値（facts）と利用者の発言にあるものだけ。違えばテンプレートに替える

export const REPLAN_CHAT_MESSAGE_TIMEOUT_MS = 6000;
// これより短い時間しか残っていなければ、LLM を呼ばずにテンプレートにする
export const MIN_MESSAGE_TIMEOUT_MS = 1500;

const SYSTEM_PROMPT = `あなたは予定を一緒に調整する秘書です。プログラムが作った案の内容（facts）を、利用者に短く伝えます。
- 2〜3文。最初に気持ちへの一言（疲れていれば労う。予定が入ったなら軽く受け止める）、次に案の要点
- 案が複数なら「案1は〜、案2は〜」と1文ずつ
- 利用者の口調に合わせる（くだけた発言にはやわらかく。ただし敬語は崩しすぎない）
- 数字（分・時間・時刻・日付）は facts にあるものだけを、そのまま書く。足し算・言い換え・丸めをしない
- warnings があれば必ず1文で伝える
- failed があるときは「できません」で終わらせず、できる範囲を伝える
- today_free_minutes_delta など、タスクのない時間は『空き時間』と書く（『自由時間』『余白』『バッファ』とは書かない）
- 利用者の選択を否定しない。説教しない`;

// 案ごとの facts（12.12 の 1。12.13 ② の options の1件）
export type OptionFacts = {
  label: string;
  summary: string[];
  today_task_minutes_delta: number;
  today_free_minutes_delta: number;
  other_days: string[]; // 「水曜：TOEICリスニング演習 +40分」
  deadline: "ok" | "late" | "none";
  warnings: string[];
  // 足した予定：「10/8（木）15:00〜16:00 面接」「毎週水曜 18:00〜19:00 ジム（今週は10/7から）」
  added_events: string[];
  added_tasks: AddedTaskFacts[];
};

// 足したタスク：{ title: "統計レポート", total_minutes: 120, deadline: "10/9", placed: ["10/6（火）60分", "10/7（水）60分"] }
export type AddedTaskFacts = { title: string; total_minutes: number; deadline: string; placed: string[] };

// 「19:00」。その日の 24:00（翌日 0:00）は「24:00」
function timeLabel(iso: string, date: string): string {
  return toDateStr(iso) > date ? "24:00" : formatTime(iso);
}

const weekdayOf = (date: string) => `${getWeekdayJa(date)}曜`;

// 1つの変更点を、操作の要約の文にする（文末の「。」は付けない）
function describeChange(change: ReplanChange, date: string): string | null {
  const range = (item: { start_at: string; end_at: string }, day = date) =>
    `${timeLabel(item.start_at, day)}〜${timeLabel(item.end_at, day)}`;
  const first = change.after[0];
  switch (change.change_type) {
    case "added": {
      if (!first) return null;
      if (first.title === "前の予定の延長") return `${range(first)} を前の予定の延長としてあける`;
      // 今日以外の日に足した予定・タスクは曜日を付ける（replan-add.md 12.18）
      const day = toDateStr(first.start_at);
      if (day !== date) return `${weekdayOf(day)}の${range(first, day)} に${first.title}を入れる`;
      return `${range(first)} に${first.title}を入れる`;
    }
    case "moved": {
      if (!change.before) return null;
      const title = change.before.title;
      if (change.moved_to_date === null) return first ? `${title}を${range(first)} に移す` : null;
      if (change.moved_to_date === date) return first ? `${title}を今日の${range(first)} にやる` : null;
      return `${title}を${weekdayOf(change.moved_to_date)}に回す`;
    }
    case "shortened":
      if (!change.before || !first) return null;
      return `${change.before.title}を${diffMinutes(first.start_at, first.end_at)}分にする`;
    case "removed":
    case "replaced":
      return change.reason.replace(/。$/, "") || null;
  }
}

// 操作の要約：コードで作る文。Engine が要約を作った案（tired_plan）はそれを使う
export function summarizeProposal(proposal: Omit<ReplanProposal, "proposal_id">): string[] {
  if (proposal.summary_message.trim() !== "") return [proposal.summary_message];
  const lines: string[] = [];
  const add = (line: string | null) => {
    if (line && !lines.includes(line)) lines.push(line);
  };
  for (const change of proposal.changes) add(describeChange(change, proposal.date));
  // 今日の側に記録のない他の日の移動（明日以降から外したタスクが別の日に戻った、など）
  const todayBefore = new Set(proposal.changes.map((change) => change.before?.id).filter(Boolean));
  for (const change of proposal.other_day_changes) {
    if (change.before && todayBefore.has(change.before.id)) continue;
    add(describeChange(change, proposal.date));
  }
  return lines;
}

// 足した予定の facts の文（replan-add.md 12.21）
function describeAddedEvent(event: FixedEvent, today: string): string {
  const date = toDateStr(event.start_at);
  const range = `${formatTime(event.start_at)}〜${timeLabel(event.end_at, date)}`;
  if (event.recurrence !== "weekly") return `${formatDateShort(date)}${range} ${event.title}`;
  const sunday = addDays(getWeekStart(today), 6);
  const from = date <= sunday ? `今週は${formatMonthDay(date)}から` : `来週の${formatMonthDay(date)}から`;
  return `毎週${weekdayOf(date)} ${range} ${event.title}（${from}）`;
}

// 足したタスクの facts：置いた回（変更点の added）を日ごとに合計する
function describeAddedTask(task: Task, proposal: Omit<ReplanProposal, "proposal_id">): AddedTaskFacts {
  const byDate = new Map<string, number>();
  for (const change of [...proposal.changes, ...proposal.other_day_changes]) {
    if (change.change_type !== "added") continue;
    for (const item of change.after) {
      if (item.kind !== "task" || item.task_id !== task.id) continue;
      const date = toDateStr(item.start_at);
      byDate.set(date, (byDate.get(date) ?? 0) + diffMinutes(item.start_at, item.end_at));
    }
  }
  return {
    title: task.title,
    total_minutes: task.estimated_minutes,
    deadline: task.deadline_at ? formatMonthDay(task.deadline_at) : "",
    placed: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, minutes]) => `${formatDateShort(date)}${minutes}分`),
  };
}

export function buildOptionFacts(input: {
  label: string;
  proposal: Omit<ReplanProposal, "proposal_id">;
  warnings: readonly string[];
  tasks: Task[];
  newFixedEvents?: readonly FixedEvent[];
  newTasks?: readonly Task[];
}): OptionFacts {
  const impact = computeReplanImpact({ ...input.proposal, proposal_id: "" }, input.tasks);
  // 目標の行動が入らなかった文（「…は今週に入りませんでした」）は、warnings に「今週の…が N 分足りなくなります」が
  // あるときは出さない（check.ts の warnings と同じく二重にしない。replan-add.md 12.18）
  const goalTaskIds = new Set(input.tasks.filter((task) => task.goal_id !== null).map((task) => task.id));
  const goalShort = input.warnings.some((warning) => /^今週の.+が\d+分足りなくなります$/.test(warning));
  const hidden = new Set(
    goalShort
      ? [...input.proposal.changes, ...input.proposal.other_day_changes]
          .filter((change) => change.change_type === "removed" && change.before?.task_id && goalTaskIds.has(change.before.task_id))
          .map((change) => change.reason.replace(/。$/, ""))
          .filter((line) => line.endsWith("は今週に入りませんでした"))
      : [],
  );
  return {
    label: input.label,
    summary: [
      ...summarizeProposal(input.proposal).filter((line) => !hidden.has(line)),
      // 来週から始まる毎週の予定は今週の変更点にないので、ここで足す
      ...(input.newFixedEvents ?? [])
        .filter((event) => toDateStr(event.start_at) > addDays(getWeekStart(input.proposal.date), 6))
        .map((event) => `${describeAddedEvent(event, input.proposal.date)}を入れる`),
    ],
    today_task_minutes_delta: impact.today.taskMinutesDelta,
    today_free_minutes_delta: impact.today.freeMinutesDelta,
    other_days: impact.otherDays.flatMap((day) =>
      day.tasks.map((task) => `${weekdayOf(day.date)}：${task.title} +${task.minutes}分`),
    ),
    deadline: impact.deadline.status === "none_moved" ? "none" : impact.deadline.status,
    warnings: [...input.warnings],
    added_events: (input.newFixedEvents ?? []).map((event) => describeAddedEvent(event, input.proposal.date)),
    added_tasks: (input.newTasks ?? []).map((task) => describeAddedTask(task, input.proposal)),
  };
}

const sentence = (text: string) => (/[。！？]$/.test(text) ? text : `${text}。`);

// 案ごとの summary_message（12.12 の 5）：操作の要約＋warnings
export function buildSummaryMessage(facts: OptionFacts): string {
  return [...facts.summary, ...facts.warnings].map(sentence).join("");
}

// ---------- 数字の検査（12.12 の 3） ----------

// 文の中の数字を、比べられる形にそろえて取り出す。
// 時刻（HH:MM・N時・N時半・N時M分）は0:00からの分（"t:1200"）、日付は "d:10/9"、長さは "m:45"（N分）・"h:2"（N時間）。
// 左から順に読み、「N時間」は「N時」より先に当てる
const NUMBER_PATTERN =
  /(\d{1,2}):(\d{2})|(\d{1,2})時(\d{1,2})分|(\d{1,2})時半|(\d+)時間(半)?|(\d{1,2})時|(\d{1,2})\/(\d{1,2})|(\d+)分/g;

export function extractNumberTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const m of text.normalize("NFKC").matchAll(NUMBER_PATTERN)) {
    if (m[1] !== undefined) tokens.push(`t:${Number(m[1]) * 60 + Number(m[2])}`);
    else if (m[3] !== undefined) tokens.push(`t:${Number(m[3]) * 60 + Number(m[4])}`);
    else if (m[5] !== undefined) tokens.push(`t:${Number(m[5]) * 60 + 30}`);
    else if (m[6] !== undefined) tokens.push(`h:${Number(m[6]) + (m[7] ? 0.5 : 0)}`);
    else if (m[8] !== undefined) tokens.push(`t:${Number(m[8]) * 60}`);
    else if (m[9] !== undefined) tokens.push(`d:${Number(m[9])}/${Number(m[10])}`);
    else if (m[11] !== undefined) tokens.push(`m:${Number(m[11])}`);
  }
  return tokens;
}

// message の数字がすべて facts・利用者の発言にあるか
export function numbersAreGrounded(message: string, facts: { options: OptionFacts[]; failed: string[] }, userText: string): boolean {
  const allowed = new Set([...extractNumberTokens(JSON.stringify(facts)), ...extractNumberTokens(userText)]);
  // 今日の増減・足したタスクの合計（数値の欄）は「N分」として書いてよい。足したタスクの合計は「N時間」でもよい
  for (const option of facts.options) {
    allowed.add(`m:${Math.abs(option.today_task_minutes_delta)}`);
    allowed.add(`m:${Math.abs(option.today_free_minutes_delta)}`);
    for (const task of option.added_tasks) {
      allowed.add(`m:${task.total_minutes}`);
      if (task.total_minutes % 30 === 0) allowed.add(`h:${task.total_minutes / 60}`);
    }
  }
  return extractNumberTokens(message).every((token) => allowed.has(token));
}

// ---------- テンプレート ----------

export function templateMessage(options: readonly OptionFacts[], failed: readonly string[]): string {
  if (options.length === 0) {
    const reason = failed[0] ? `（${failed[0].replace(/。$/, "")}）` : "";
    return `ごめんなさい、その変え方では今日の予定に入れられませんでした${reason}。時刻を変えたり、ほかのタスクを減らしたりする形なら調整できるので、もう一度教えてください。`;
  }
  const head =
    options.length === 1
      ? `${options[0].label}の案を用意しました。`
      : `案を${options.length}つ用意しました。${options.map((option, i) => `案${i + 1}：${option.label}`).join("、")}。`;
  // 足した予定・タスク（replan-add.md 12.21）。案が複数なら「案{n}：」を付ける
  const additions = options.flatMap((option, i) =>
    additionsOf(option).map((line) => sentence(options.length === 1 ? line : `案${i + 1}：${line}`)),
  );
  const warnings = [...new Set(options.flatMap((option) => option.warnings))].map(sentence);
  return head + additions.join("") + warnings.join("");
}

function additionsOf(option: OptionFacts): string[] {
  return [
    ...option.added_events.map((event) => `${event}を入れます`),
    ...option.added_tasks.map((task) => {
      const name = `${task.title}（${task.total_minutes}分・${task.deadline}まで）`;
      return task.placed.length > 0 ? `${name}を${task.placed.join("、")}に入れます` : `${name}を足します`;
    }),
  ];
}

// 説明の呼び出し（12.13 ②）→ 数字の検査。LLM が失敗したとき・数字が合わないときはテンプレート
export async function writeReplanChatMessage(input: {
  userText: string;
  options: OptionFacts[];
  failed: string[];
  timeoutMs?: number;
}): Promise<string> {
  const facts = { options: input.options, failed: input.failed };
  const timeoutMs = Math.min(input.timeoutMs ?? REPLAN_CHAT_MESSAGE_TIMEOUT_MS, REPLAN_CHAT_MESSAGE_TIMEOUT_MS);
  if (timeoutMs < MIN_MESSAGE_TIMEOUT_MS) return templateMessage(input.options, input.failed);
  try {
    const { message } = await callStructured({
      name: "replan_chat_message",
      system: SYSTEM_PROMPT,
      user: JSON.stringify({ message: input.userText, ...facts }),
      schema: ReplanChatMessageLlmSchema,
      timeoutMs,
      retries: 0,
      temperature: 0.5,
    });
    if (message.trim() !== "" && numbersAreGrounded(message, facts, input.userText)) return message.trim();
    console.warn("[llm] replan_chat_message ok=false kind=ungrounded_number");
  } catch (e) {
    if (!(e instanceof LlmError)) console.warn("[llm] replan_chat_message failed:", e instanceof Error ? e.name : typeof e);
  }
  return templateMessage(input.options, input.failed);
}
