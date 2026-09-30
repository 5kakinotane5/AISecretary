import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ObjectiveVectorSchema,
  PlanStyleSchema,
  PlanSummarySchema,
  ScheduleCandidateSchema,
  ScheduleItemSchema,
  type ObjectiveVector,
  type PlanStyle,
  type PlanSummary,
  type ReasonCode,
  type ScheduleCandidate,
  type ScheduleItem,
} from "@/lib/schemas";
import { addDays, toJstIso } from "@/lib/datetime";
import { HttpError } from "../http";

// 有効な計画で利用者が完了にしたタスク枠
export type CompletedTaskItem = { task_id: string; date: string; start_at: string; end_at: string };

// 計画（weekly_plans の1行）の見出し
export type PlanHeader = { id: string; style: PlanStyle; week_start: string; status: string };

// 案の表示順（11.1：intensive・balanced・relaxed の順）
const STYLE_ORDER: Record<PlanStyle, number> = { intensive: 0, balanced: 1, relaxed: 2 };

const ITEM_COLUMNS =
  "id, weekly_plan_id, date, kind, title, start_at, end_at, location_id, task_id, fixed_event_id, fixed_category, travel, suggested_task_id, locked, status, reason";

// save_generation に渡す行。テーブルの列名と同じキーをすべて持つ（backend.md 4.4）
export type WeeklyPlanRow = {
  id: string;
  generation_id: string;
  week_start: string;
  style: PlanStyle;
  label: string;
  summary: PlanSummary;
  features: ObjectiveVector;
};
export type PlanItemRow = ScheduleItem & {
  user_id: string;
  weekly_plan_id: string;
  date: string;
  reason_code: ReasonCode | null;
  carried: boolean;
};

function toHeader(row: Record<string, unknown>): PlanHeader {
  return {
    id: String(row.id),
    style: PlanStyleSchema.parse(row.style),
    week_start: String(row.week_start),
    status: String(row.status),
  };
}

// DB の行 → ScheduleItem。timestamptz は +09:00 付きにする
function toItem(row: Record<string, unknown>): ScheduleItem {
  return ScheduleItemSchema.parse({
    ...row,
    start_at: toJstIso(String(row.start_at)),
    end_at: toJstIso(String(row.end_at)),
  });
}

// 有効な計画（status = 'active'。利用者ごとに最大1件）。なければ null
export async function getActivePlan(supabase: SupabaseClient): Promise<PlanHeader | null> {
  const { data, error } = await supabase
    .from("weekly_plans")
    .select("id, style, week_start, status")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data ? toHeader(data) : null;
}

// 有効な計画の id。なければ null
export async function getActivePlanId(supabase: SupabaseClient): Promise<string | null> {
  return (await getActivePlan(supabase))?.id ?? null;
}

// 自分の計画1件（状態は問わない）。ない・他人のもの・UUID でない id は null
export async function getPlan(supabase: SupabaseClient, id: string): Promise<PlanHeader | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await supabase
    .from("weekly_plans")
    .select("id, style, week_start, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toHeader(data) : null;
}

// 計画の項目（日付 → 開始時刻の順）。weekly_plan_id ごとに分けて返す
export async function listPlanItems(
  supabase: SupabaseClient,
  planIds: string[],
): Promise<Map<string, { date: string; item: ScheduleItem }[]>> {
  const byPlan = new Map<string, { date: string; item: ScheduleItem }[]>(planIds.map((id) => [id, []]));
  if (planIds.length === 0) return byPlan;
  const { data, error } = await supabase
    .from("daily_plan_items")
    .select(ITEM_COLUMNS)
    .in("weekly_plan_id", planIds)
    .order("date", { ascending: true })
    .order("start_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  for (const row of data) byPlan.get(row.weekly_plan_id)?.push({ date: row.date, item: toItem(row) });
  return byPlan;
}

// 有効な計画のうち、明示的に完了したタスク項目。計画がなければ空配列
export async function listCompletedActivePlanTaskItems(supabase: SupabaseClient): Promise<CompletedTaskItem[]> {
  const planId = await getActivePlanId(supabase);
  if (!planId) return [];
  const { data, error } = await supabase
    .from("daily_plan_items")
    .select("task_id, date, start_at, end_at")
    .eq("weekly_plan_id", planId)
    .eq("kind", "task")
    .eq("carried", false)
    .eq("status", "completed")
    .not("task_id", "is", null)
  if (error) throw error;
  return data.map((row) => ({
    task_id: row.task_id,
    date: row.date,
    start_at: toJstIso(row.start_at),
    end_at: toJstIso(row.end_at),
  }));
}

// 今日の有効計画にあるタスク枠だけ完了状態を更新する。DB 関数内で版番号も進め、再計画案を失効させる
export async function setActivePlanTaskCompletion(
  supabase: SupabaseClient,
  itemId: string,
  date: string,
  completed: boolean,
): Promise<"planned" | "completed"> {
  const { data, error } = await supabase.rpc("set_task_slot_completion", {
    p_item_id: itemId,
    p_date: date,
    p_completed: completed,
  });
  if (error?.message === "NOT_FOUND") {
    throw new HttpError(404, "NOT_FOUND", "今日の計画タスクが見つかりません");
  }
  if (error?.message === "INVALID_STATE") {
    throw new HttpError(409, "INVALID_STATE", "今日の有効な計画タスクだけ変更できます");
  }
  if (error) throw error;
  return data === "completed" ? "completed" : "planned";
}

// 3案を保存する（save_generation を rpc。backend.md 4.4、plans-replan.md 11.1）。
// 前の候補は discarded になり、セッションは PLAN_PROPOSED になる。セッションがなければ HttpError(404)
export async function saveGeneration(
  supabase: SupabaseClient,
  sessionId: string,
  plans: WeeklyPlanRow[],
  items: PlanItemRow[],
): Promise<void> {
  const { error } = await supabase.rpc("save_generation", {
    p_session_id: sessionId,
    p_plans: plans,
    p_items: items,
  });
  if (error?.message === "NOT_FOUND") {
    throw new HttpError(404, "NOT_FOUND", "ヒアリングが見つかりません。最初からやり直してください");
  }
  if (error) throw error;
}

// 最新の生成（created_at が最も新しい generation_id）で、week_start が weekStart の3案。なければ空配列
export async function listLatestCandidates(supabase: SupabaseClient, weekStart: string): Promise<ScheduleCandidate[]> {
  const latest = await supabase
    .from("weekly_plans")
    .select("generation_id")
    .eq("week_start", weekStart)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;
  if (!latest.data) return [];

  const { data, error } = await supabase
    .from("weekly_plans")
    .select("id, style, label, week_start, summary")
    .eq("generation_id", latest.data.generation_id);
  if (error) throw error;

  const itemsByPlan = await listPlanItems(supabase, data.map((row) => row.id));
  return data
    .map((row) => {
      const entries = itemsByPlan.get(row.id) ?? [];
      const dates = Array.from({ length: 7 }, (_, i) => addDays(row.week_start, i));
      return ScheduleCandidateSchema.parse({
        id: row.id,
        style: row.style,
        label: row.label,
        week_start: row.week_start,
        summary: PlanSummarySchema.parse(row.summary),
        days: dates.map((date) => ({ date, items: entries.filter((e) => e.date === date).map((e) => e.item) })),
      });
    })
    .sort((a, b) => STYLE_ORDER[a.style] - STYLE_ORDER[b.style]);
}

// 案を選ぶ（select_plan を rpc。backend.md 4.4）。候補でなければ HttpError(404)
export async function selectPlan(supabase: SupabaseClient, planId: string, now: string): Promise<void> {
  const { error } = await supabase.rpc("select_plan", { p_plan_id: planId, p_now: now });
  if (error?.message === "NOT_FOUND") throw new HttpError(404, "NOT_FOUND", "選べる案が見つかりません");
  if (error) throw error;
}

// 計画の features（目的ベクトル。weekly_plans.features）。id → ObjectiveVector
export async function listPlanFeatures(
  supabase: SupabaseClient,
  planIds: string[],
): Promise<Map<string, ObjectiveVector>> {
  const byPlan = new Map<string, ObjectiveVector>();
  if (planIds.length === 0) return byPlan;
  const { data, error } = await supabase.from("weekly_plans").select("id, features").in("id", planIds);
  if (error) throw error;
  for (const row of data) byPlan.set(String(row.id), ObjectiveVectorSchema.parse(row.features));
  return byPlan;
}
