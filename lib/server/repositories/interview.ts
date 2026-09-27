import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  GoalSchema,
  GoalTimeCandidateSchema,
  InterviewExtractedCheckedSchema,
  InterviewMessageSchema,
  InterviewStateSchema,
  InterviewStepSchema,
  type Goal,
  type GoalTimeCandidate,
  type InterviewMessage,
  type InterviewState,
  type InterviewStep,
} from "@/lib/schemas";
import { toJstIso } from "@/lib/datetime";

// ヒアリングで抽出した項目（interview_sessions.slots。backend.md 6.2.2）
export type InterviewSlots = z.infer<typeof InterviewExtractedCheckedSchema>;

export const EMPTY_SLOTS: InterviewSlots = {
  category: null,
  task_name: null,
  goal_text: null,
  current_status: null,
  deadline: null,
  conditions: [],
  explicit_hours_per_week: null,
  frequency_per_week: null,
  weekday_time_band: null,
  weekend_time_band: null,
};

// 抽出結果を slots にマージする。null・空配列では上書きしない（backend.md 6.2.1）。台本と LLM の両方で使う
export function mergeSlots(slots: InterviewSlots, extracted: Partial<InterviewSlots>): InterviewSlots {
  const merged = { ...slots };
  for (const [key, value] of Object.entries(extracted) as [keyof InterviewSlots, unknown][]) {
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    Object.assign(merged, { [key]: value });
  }
  return merged;
}

// DB の state には画面に返さない ABANDONED もある（backend.md 4.2）
export type InterviewSessionState = InterviewState | "ABANDONED";
const SessionStateSchema = z.union([InterviewStateSchema, z.literal("ABANDONED")]);

export type InterviewSession = {
  id: string;
  state: InterviewSessionState;
  step: InterviewStep;
  step_index: number;
  retry_count: number;
  slots: InterviewSlots;
  goal_candidates: GoalTimeCandidate[] | null;
  // selection の後に入る目標案（FR-03-5）。id は selection のときに振り、confirm でもそのまま使う
  goal_draft: Goal | null;
};

// セッションの書き込める列
export type InterviewSessionWrite = Omit<InterviewSession, "id">;

export type InterviewMessageWrite = Pick<InterviewMessage, "role" | "text">;

const SESSION_COLUMNS = "id, state, step, step_index, retry_count, slots, goal_candidates, goal_draft";
const MESSAGE_COLUMNS = "id, role, text, created_at";

function toSession(row: Record<string, unknown>): InterviewSession {
  return {
    id: z.string().parse(row.id),
    state: SessionStateSchema.parse(row.state),
    step: InterviewStepSchema.parse(row.step),
    step_index: z.number().int().parse(row.step_index),
    retry_count: z.number().int().parse(row.retry_count),
    // slots の既定値は {}。足りないキーは空の値で埋める
    slots: InterviewExtractedCheckedSchema.parse({ ...EMPTY_SLOTS, ...(row.slots as object | null) }),
    goal_candidates: z.array(GoalTimeCandidateSchema).nullable().parse(row.goal_candidates ?? null),
    goal_draft: GoalSchema.nullable().parse(row.goal_draft ?? null),
  };
}

function toMessage(row: Record<string, unknown>): InterviewMessage {
  return InterviewMessageSchema.parse({ ...row, created_at: toJstIso(String(row.created_at)) });
}

async function insertMessages(
  supabase: SupabaseClient,
  sessionId: string,
  messages: InterviewMessageWrite[],
): Promise<InterviewMessage[]> {
  // insert の返り値の順は入れた順とは限らないので、id を先に決めて入れた順に並べ直す
  const rows = messages.map((m) => ({ id: crypto.randomUUID(), session_id: sessionId, role: m.role, text: m.text }));
  const { data, error } = await supabase.from("interview_messages").insert(rows).select(MESSAGE_COLUMNS);
  if (error) throw error;
  return rows.map((r) => toMessage(data.find((row) => row.id === r.id) ?? {}));
}

// 新しいセッションを作り、最初の AI の発言を保存する。
// 進行中の古いセッション（INTERVIEWING・CONFIRMING）は ABANDONED にする（backend.md 6.2.4）
export async function startInterviewSession(
  supabase: SupabaseClient,
  values: InterviewSessionWrite,
  aiText: string,
): Promise<{ session: InterviewSession; messages: InterviewMessage[] }> {
  const abandoned = await supabase
    .from("interview_sessions")
    .update({ state: "ABANDONED" })
    .in("state", ["INTERVIEWING", "CONFIRMING"]);
  if (abandoned.error) throw abandoned.error;

  const { data, error } = await supabase.from("interview_sessions").insert(values).select(SESSION_COLUMNS).single();
  if (error) throw error;
  const session = toSession(data);

  const messages = await insertMessages(supabase, session.id, [{ role: "ai", text: aiText }]);
  return { session, messages };
}

// 自分のセッション。ない・他人のもの・UUID でない id は null
export async function getInterviewSession(supabase: SupabaseClient, id: string): Promise<InterviewSession | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await supabase.from("interview_sessions").select(SESSION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toSession(data) : null;
}

// セッションの直近 limit 件の発言（古い順）。ヒアリングの LLM に渡す（6.2.3）。
// 1回のやり取りの発言は1回の insert で入れるので created_at が同じになる。その中は「利用者 → AI」の順なので、
// 同じ時刻では role で並べる（新しい順では ai が先）
export async function listRecentMessages(
  supabase: SupabaseClient,
  sessionId: string,
  limit: number,
): Promise<InterviewMessage[]> {
  const { data, error } = await supabase
    .from("interview_messages")
    .select(MESSAGE_COLUMNS)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .order("role", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data.map(toMessage).reverse();
}

// 1回のやり取り（発言とセッションの更新）を保存し、保存した発言を返す。
// before の state・step_index・retry_count のままのときだけ更新する（同時に2回送られたときに二重に進めない。
// 聞き直しでは step_index が変わらないので retry_count も見る）。
// 更新できなかったら入れた発言を消して null を返す（状態も発言も残さない。backend.md 6.2.1）
export async function saveInterviewTurn(
  supabase: SupabaseClient,
  before: InterviewSession,
  next: InterviewSessionWrite,
  messages: InterviewMessageWrite[],
): Promise<InterviewMessage[] | null> {
  const saved = await insertMessages(supabase, before.id, messages);
  const removeSaved = () =>
    supabase
      .from("interview_messages")
      .delete()
      .in("id", saved.map((m) => m.id));

  const { data, error } = await supabase
    .from("interview_sessions")
    .update(next)
    .eq("id", before.id)
    .eq("state", before.state)
    .eq("step_index", before.step_index)
    .eq("retry_count", before.retry_count)
    .select("id");
  if (error || data.length === 0) {
    await removeSaved();
    if (error) throw error;
    return null;
  }
  return saved;
}
