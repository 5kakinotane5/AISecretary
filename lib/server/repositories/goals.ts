import type { SupabaseClient } from "@supabase/supabase-js";
import { GoalSchema, type Goal } from "@/lib/schemas";

// 有効な目標（status = 'active'。利用者ごとに最大1件）。なければ null
export async function getActiveGoal(supabase: SupabaseClient): Promise<Goal | null> {
  const { data, error } = await supabase
    .from("goals")
    .select("id, task_name, category, target_hours_per_week, frequency, deadline, priority, conditions, user_selected_plan")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return GoalSchema.parse({
    ...data,
    // numeric は文字列で返ることがある
    target_hours_per_week: data.target_hours_per_week === null ? null : Number(data.target_hours_per_week),
    conditions: data.conditions ?? [],
    // date は "YYYY-MM-DD" の文字列で返る
  });
}
