import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ReasonCodeSchema,
  ScheduleItemSchema,
  type FixedEvent,
  type ReplanProposal,
} from "@/lib/schemas";
import { toJstIso } from "@/lib/datetime";
import { HttpError } from "../http";
import type { PlanItemRow } from "./plans";
import type { NewTaskRow } from "@/lib/server/replan-rows";

// 再計画の提案（replan_proposals）と、提案を作るときに読む計画の値（plans-replan.md 12.2・12.6）

const ROW_COLUMNS =
  "id, user_id, weekly_plan_id, date, kind, title, start_at, end_at, location_id, task_id, fixed_event_id, fixed_category, travel, suggested_task_id, locked, status, reason, reason_code, carried";

// fixed_events の1行（apply_replan がそのまま insert する。列名と同じキーをすべて持つ）
export type FixedEventRow = FixedEvent & { user_id: string };

// 計画の version（再計画の base_version）。計画がなければ null
export async function getPlanVersion(
  supabase: SupabaseClient,
  planId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("weekly_plans")
    .select("version")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.version) : null;
}

// 計画の項目を、保存されている行のまま（reason_code・carried を含む）。id → 行
export async function listPlanItemRows(
  supabase: SupabaseClient,
  planId: string,
): Promise<Map<string, PlanItemRow>> {
  const { data, error } = await supabase
    .from("daily_plan_items")
    .select(ROW_COLUMNS)
    .eq("weekly_plan_id", planId);
  if (error) throw error;
  const rows = new Map<string, PlanItemRow>();
  for (const row of data) {
    const item = ScheduleItemSchema.parse({
      ...row,
      start_at: toJstIso(String(row.start_at)),
      end_at: toJstIso(String(row.end_at)),
    });
    rows.set(item.id, {
      ...item,
      user_id: String(row.user_id),
      weekly_plan_id: String(row.weekly_plan_id),
      date: String(row.date),
      reason_code: ReasonCodeSchema.nullable().parse(row.reason_code ?? null),
      carried: Boolean(row.carried),
    });
  }
  return rows;
}

export type ReplanProposalInsert = {
  id: string;
  weekly_plan_id: string;
  date: string;
  proposal: ReplanProposal;
  updated_days: { date: string; items: PlanItemRow[] }[];
  new_fixed_events: FixedEventRow[];
  // accept で tasks に入れる行（replan-add.md 12.19）。ないときは送らない（列の default '[]'。
  // 0004 のマイグレーションの前でも、タスクを足さない提案は保存できるように）
  new_tasks?: NewTaskRow[];
  base_version: number;
  expires_at: string;
};

// 提案を保存する（status は pending）
export async function insertReplanProposal(
  supabase: SupabaseClient,
  row: ReplanProposalInsert,
): Promise<void> {
  const { error } = await supabase.from("replan_proposals").insert(row);
  if (error) throw error;
}

// 自分の提案の日付。ない・他人のもの・UUID でない id は null
export async function getReplanProposalDate(
  supabase: SupabaseClient,
  id: string,
): Promise<string | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await supabase
    .from("replan_proposals")
    .select("date")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? String(data.date) : null;
}

// 次の2つは、自分の（user_id）・その日の（date）・pending の提案だけに絞る（他人の id・UUID でない id は触れない）
const uuidsOf = (ids: readonly string[]) => ids.filter((id) => z.uuid().safeParse(id).success);

// 提案を discarded にする（replan-chat.md 12.14。会話の「やっぱりナシ」）。
// 自分の・その日の・pending の提案だけを変える
export async function discardReplanProposals(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  ids: readonly string[],
): Promise<void> {
  const valid = uuidsOf(ids);
  if (valid.length === 0) return;
  const { error } = await supabase
    .from("replan_proposals")
    .update({ status: "discarded" })
    .in("id", valid)
    .eq("user_id", userId)
    .eq("date", date)
    .eq("status", "pending");
  if (error) throw error;
}

// 提案の label（会話の経路で保存したもの。replan-chat.md 12.13 ① の open_options）。id → label。
// 自分の・その日の・pending の提案だけ。label がない（12.2 の経路で作った）提案は intent.type を返す
export async function getReplanProposalLabels(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  ids: readonly string[],
): Promise<Map<string, { label: string | null; intent_type: string | null }>> {
  const result = new Map<string, { label: string | null; intent_type: string | null }>();
  const valid = uuidsOf(ids);
  if (valid.length === 0) return result;
  const { data, error } = await supabase
    .from("replan_proposals")
    .select("id, proposal")
    .in("id", valid)
    .eq("user_id", userId)
    .eq("date", date)
    .eq("status", "pending");
  if (error) throw error;
  for (const row of data ?? []) {
    const proposal = (row.proposal ?? {}) as { label?: unknown; intent?: { type?: unknown } };
    result.set(String(row.id), {
      label: typeof proposal.label === "string" ? proposal.label : null,
      intent_type: typeof proposal.intent?.type === "string" ? proposal.intent.type : null,
    });
  }
  return result;
}

// 提案を反映する（apply_replan を rpc。backend.md 4.4、plans-replan.md 12.6）
export async function applyReplan(supabase: SupabaseClient, proposalId: string): Promise<void> {
  const { error } = await supabase.rpc("apply_replan", { p_proposal_id: proposalId });
  if (error?.message === "NOT_FOUND") throw new HttpError(404, "NOT_FOUND", "提案が見つかりません");
  if (error?.message === "PROPOSAL_EXPIRED") {
    throw new HttpError(
      409,
      "PROPOSAL_EXPIRED",
      "時間がたったため、この提案は使えません。もう一度伝えてください。",
    );
  }
  if (error) throw error;
}
