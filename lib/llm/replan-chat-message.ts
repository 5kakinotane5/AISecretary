import { ReplanChatMessageLlmSchema, type ReplanChange, type ReplanProposal, type Task } from "@/lib/schemas";
import { diffMinutes, formatTime, getWeekdayJa, toDateStr } from "@/lib/datetime";
import { callStructured, LlmError } from "@/lib/llm/client";
import { computeReplanImpact } from "@/lib/replan-impact";

// 会話の再計画：説明の文章と数字の検査（replan-chat.md 12.12・12.13 ②）。
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
};

// 「19:00」。その日の 24:00（翌日 0:00）は「24:00」
function timeLabel(iso: string, date: string): string {
  return toDateStr(iso) > date ? "24:00" : formatTime(iso);
}

const weekdayOf = (date: string) => `${getWeekdayJa(date)}曜`;

// 1つの変更点を、操作の要約の文にする（文末の「。」は付けない）
function describeChange(change: ReplanChange, date: string): string | null {
  const range = (item: { start_at: string; end_at: string }) =>
    `${timeLabel(item.start_at, date)}〜${timeLabel(item.end_at, date)}`;
  const first = change.after[0];
  switch (change.change_type) {
    case "added":
      if (!first) return null;
      if (first.title === "前の予定の延長") return `${range(first)} を前の予定の延長としてあける`;
      return `${range(first)} に${first.title}を入れる`;
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

export function buildOptionFacts(input: {
  label: string;
  proposal: Omit<ReplanProposal, "proposal_id">;
  warnings: readonly string[];
  tasks: Task[];
}): OptionFacts {
  const impact = computeReplanImpact({ ...input.proposal, proposal_id: "" }, input.tasks);
  return {
    label: input.label,
    summary: summarizeProposal(input.proposal),
    today_task_minutes_delta: impact.today.taskMinutesDelta,
    today_free_minutes_delta: impact.today.freeMinutesDelta,
    other_days: impact.otherDays.flatMap((day) =>
      day.tasks.map((task) => `${weekdayOf(day.date)}：${task.title} +${task.minutes}分`),
    ),
    deadline: impact.deadline.status === "none_moved" ? "none" : impact.deadline.status,
    warnings: [...input.warnings],
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
  // 今日の増減（数値の欄）は「N分」として書いてよい
  for (const option of facts.options) {
    allowed.add(`m:${Math.abs(option.today_task_minutes_delta)}`);
    allowed.add(`m:${Math.abs(option.today_free_minutes_delta)}`);
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
  const warnings = [...new Set(options.flatMap((option) => option.warnings))].map(sentence);
  return head + warnings.join("");
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
