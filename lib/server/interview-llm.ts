import type { z } from "zod";
import {
  INTERVIEW_CATEGORIES,
  InterviewExtractedCheckedSchema,
  type GoalTimeCandidate,
  type InterviewLlmSchema,
  type InterviewMessage,
  type InterviewStep,
} from "@/lib/schemas";
import { formatMonthDay, toDateStr } from "@/lib/datetime";
import { LlmError } from "@/lib/llm/client";
import { extractInterviewByLlm, type InterviewLlmInput } from "@/lib/llm/interview";
import { mergeSlots, type InterviewSession, type InterviewSlots } from "./repositories/interview";

// LLM_MODE=on のヒアリング（backend.md 6.2.3）。LLM は抽出と次の発言の文章だけを作り、
// 進むか聞き直すかはサーバーが決める（6.2.1・6.2.2）。LLM の失敗（LlmError）はそのまま投げる（route が 502 にする）

type ExtractedRaw = z.infer<typeof InterviewLlmSchema>["extracted"];

// route が保存・返却するやり取りの結果（台本と LLM で同じ形）
export type InterviewAnswer = {
  slots: InterviewSlots; // マージ後
  step: InterviewStep;
  step_index: number;
  retry_count: number;
  ai_message: string;
  quick_replies: string[];
  goal_candidates: GoalTimeCandidate[] | null; // ステップ4の回答で進んだときだけ
};

type StepIndex = 1 | 2 | 3 | 4;

// ステップ1〜4 の名前と、その次のステップ（6.2.2。ステップ4の次は time_estimation）
const STEPS: Record<StepIndex, { current: InterviewLlmInput["current_step"]; next: InterviewLlmInput["next_step"] }> = {
  1: { current: "category", next: "goal" },
  2: { current: "goal", next: "current_status" },
  3: { current: "current_status", next: "conditions" },
  4: { current: "conditions", next: "time_estimation" },
};

// 聞き直しの上限（6.2.2）。ステップ3・4 は聞き直さない
const RETRY_LIMIT: Record<StepIndex, number> = { 1: 1, 2: 2, 3: 0, 4: 0 };

// 聞き直しの発言（固定文）とクイックリプライ
const RETRY_QUESTIONS: Record<1 | 2, { ai_message: string; quick_replies: string[] }> = {
  1: {
    ai_message: "すみません、うまく受け取れませんでした。いちばん近いものを選んでください。",
    quick_replies: [...INTERVIEW_CATEGORIES],
  },
  2: { ai_message: "目標を短い言葉で教えてください（例：TOEICで730点、週3回ジムに通う）。", quick_replies: [] },
};

const UNDECIDED = "未定";
const MAX_QUICK_REPLIES = 5; // FR-02-3
const MAX_QUICK_REPLY_LENGTH = 20;
const MAX_CONDITIONS = 5;

const shape = InterviewExtractedCheckedSchema.shape;

// 文字列は trim し、空なら null
const trimOrNull = (value: string | null) => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

// 1項目を検証し、通らなければ null
function checked<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

// 実在する日付か（「2026-02-30」などを除く）
function isRealDate(date: string): boolean {
  try {
    return toDateStr(date) === date;
  } catch {
    return false; // 月が13などで日付として読めない
  }
}

// LLM の抽出結果を項目ごとに検証する（3.3）。通らない項目だけ null にし、conditions は通るものだけを先頭5件まで残す。
// deadline は形が違う・実在しない・today（YYYY-MM-DD）より前なら null
export function checkExtracted(raw: ExtractedRaw, today: string): InterviewSlots {
  const deadline = checked(shape.deadline, trimOrNull(raw.deadline));
  return {
    category: checked(shape.category, raw.category),
    task_name: checked(shape.task_name, trimOrNull(raw.task_name)),
    goal_text: checked(shape.goal_text, trimOrNull(raw.goal_text)),
    current_status: checked(shape.current_status, trimOrNull(raw.current_status)),
    deadline: deadline !== null && isRealDate(deadline) && deadline >= today ? deadline : null,
    conditions: raw.conditions
      .map((c) => c.trim())
      .filter((c) => shape.conditions.element.safeParse(c).success)
      .slice(0, MAX_CONDITIONS),
    explicit_hours_per_week: checked(shape.explicit_hours_per_week, raw.explicit_hours_per_week),
    frequency_per_week: checked(shape.frequency_per_week, raw.frequency_per_week),
    weekday_time_band: checked(shape.weekday_time_band, raw.weekday_time_band),
    weekend_time_band: checked(shape.weekend_time_band, raw.weekend_time_band),
  };
}

// deadline と同じ月・日を表す条件（「12月13日の試験まで」「12/13」）を conditions から落とす。
// 要約で期限が「12/13まで」と条件の両方に出ないようにするため。deadline が null なら何もしない。
// NFKC で正規化して「M月D日」「M/D」（先頭の0あり・なし）を探す。別の日付の条件は残す
export function dropDeadlineConditions(slots: InterviewSlots): InterviewSlots {
  if (slots.deadline === null) return slots;
  const [, month, day] = slots.deadline.split("-").map(Number);
  const md = new RegExp(`(?<!\\d)0?${month}(月0?${day}日|/0?${day}(?!\\d))`);
  return { ...slots, conditions: slots.conditions.filter((c) => !md.test(c.normalize("NFKC"))) };
}

// 進むか聞き直すか（6.2.2 の表）。slots はマージ後。retryCount はこのステップで今までに聞き直した回数。
// ステップ1で上限に達したら category を「その他」にして進む。ステップ2で上限に達したら task_name は null のまま進む
// （buildGoalDraft が taskNameOf で仮置きする）
export function decideNext(
  stepIndex: StepIndex,
  retryCount: number,
  slots: InterviewSlots,
): { advance: boolean; slots: InterviewSlots } {
  const filled = stepIndex === 1 ? slots.category !== null : stepIndex === 2 ? slots.task_name !== null : true;
  if (filled) return { advance: true, slots };
  if (retryCount < RETRY_LIMIT[stepIndex]) return { advance: false, slots };
  return { advance: true, slots: stepIndex === 1 ? { ...slots, category: "その他" } : slots };
}

// LLM のクイックリプライの案を整える（FR-02-3）：trim・空を除く・20文字以内・重複なし・最大5個。
// withUndecided なら末尾に「未定」を必ず付ける（5個を超えるなら LLM の案を削る）
export function normalizeQuickReplies(replies: readonly string[], withUndecided: boolean): string[] {
  const seen = new Set<string>();
  for (const reply of replies) {
    const r = reply.trim();
    if (r === "" || [...r].length > MAX_QUICK_REPLY_LENGTH) continue;
    if (withUndecided && r === UNDECIDED) continue;
    seen.add(r);
  }
  const result = [...seen].slice(0, withUndecided ? MAX_QUICK_REPLIES - 1 : MAX_QUICK_REPLIES);
  return withUndecided ? [...result, UNDECIDED] : result;
}

// ステップ5（time_estimation）の発言（6.2.3。LLM を使わずテンプレート）。periodWeeks は3案の period_weeks
export function buildTimeEstimationMessage(deadline: string | null, periodWeeks: number | null): string {
  const untilDeadline =
    deadline !== null && periodWeeks !== null ? `${formatMonthDay(deadline)}まで約${periodWeeks}週間です。` : "";
  return `ありがとうございます。${untilDeadline}登録済みの授業・バイトの予定もふまえて、目標時間の案を3つ作りました。どれも正解・不正解はないので、しっくりくるものを選んでください。`;
}

// ステップ1〜4 の text に LLM で答える。recentMessages は今回の発言を含まない直近の発言（古い順）、today は YYYY-MM-DD。
// loadGoalCandidates はステップ4の回答で進んだときだけ呼ぶ（3案。route が PlanningContext から作る）
export async function answerByLlm(args: {
  session: InterviewSession;
  stepIndex: StepIndex;
  text: string;
  recentMessages: readonly Pick<InterviewMessage, "role" | "text">[];
  today: string;
  loadGoalCandidates: (slots: InterviewSlots) => Promise<GoalTimeCandidate[]>;
}): Promise<InterviewAnswer> {
  const { session, stepIndex, today } = args;
  const steps = STEPS[stepIndex];

  // next_step は「進んだ場合」の値で渡す（抽出の前には進むか分からないため）
  const llm = await extractInterviewByLlm({
    current_step: steps.current,
    next_step: steps.next,
    slots: session.slots,
    recent_messages: args.recentMessages.map((m) => ({ role: m.role, text: m.text })),
    text: args.text,
    today,
  });

  // マージ後にかける（前のターンの deadline と、今回の同じ日付の条件の組み合わせも落とすため）
  const merged = dropDeadlineConditions(mergeSlots(session.slots, checkExtracted(llm.extracted, today)));
  const decision = decideNext(stepIndex, session.retry_count, merged);
  const slots = decision.slots;

  // 聞き直し：step_index は変えず、発言は固定文（LLM の next_message は使わない）
  if (!decision.advance) {
    const retry = RETRY_QUESTIONS[stepIndex as 1 | 2]; // 聞き直すのはステップ1・2だけ
    return {
      slots,
      step: session.step,
      step_index: session.step_index,
      retry_count: session.retry_count + 1,
      ai_message: retry.ai_message,
      quick_replies: retry.quick_replies,
      goal_candidates: null,
    };
  }

  // ステップ4の回答：ステップ5の発言（テンプレート）と3案を返し、画面はステップ6で3案を出す（FR-02-5）
  if (stepIndex === 4) {
    const candidates = await args.loadGoalCandidates(slots);
    return {
      slots,
      step: "goal_candidates",
      step_index: 6,
      retry_count: 0,
      ai_message: buildTimeEstimationMessage(slots.deadline, candidates[0]?.period_weeks ?? null),
      quick_replies: [],
      goal_candidates: candidates,
    };
  }

  // 次の質問が空では会話が続かないので、形の違う応答として扱う（502。画面の「再試行」で送り直せる）
  const aiMessage = llm.next_message.trim();
  if (aiMessage === "") throw new LlmError("invalid_shape", "empty next_message");

  const nextIndex = (stepIndex + 1) as 2 | 3 | 4;
  return {
    slots,
    step: steps.next,
    step_index: nextIndex,
    retry_count: 0,
    ai_message: aiMessage,
    quick_replies: normalizeQuickReplies(llm.quick_replies, nextIndex === 4),
    goal_candidates: null,
  };
}
