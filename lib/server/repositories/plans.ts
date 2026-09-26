import type { SupabaseClient } from "@supabase/supabase-js";
import { toJstIso } from "@/lib/datetime";

// 有効な計画のタスク項目のうち、実施済みとみなすもの（補正 C-5）
export type ElapsedTaskItem = { task_id: string; date: string; start_at: string; end_at: string };

// 有効な計画（status = 'active'。利用者ごとに最大1件）の id。なければ null
export async function getActivePlanId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("weekly_plans")
    .select("id")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// 有効な計画のタスク項目で、carried = false かつ end_at ≤ now のもの。計画がなければ空配列
export async function listElapsedActivePlanTaskItems(
  supabase: SupabaseClient,
  now: string,
): Promise<ElapsedTaskItem[]> {
  const planId = await getActivePlanId(supabase);
  if (!planId) return [];
  const { data, error } = await supabase
    .from("daily_plan_items")
    .select("task_id, date, start_at, end_at")
    .eq("weekly_plan_id", planId)
    .eq("kind", "task")
    .eq("carried", false)
    .not("task_id", "is", null)
    .lte("end_at", now);
  if (error) throw error;
  return data.map((row) => ({
    task_id: row.task_id,
    date: row.date,
    start_at: toJstIso(row.start_at),
    end_at: toJstIso(row.end_at),
  }));
}
