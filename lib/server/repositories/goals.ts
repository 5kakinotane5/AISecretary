import type { SupabaseClient } from "@supabase/supabase-js";
import { GoalSchema, TimeBandSchema, type Goal, type TimeBand } from "@/lib/schemas";
import { toJstIso } from "@/lib/datetime";

// 有効な目標と、GoalSchema に無い列（今週の目標分・時間帯の希望に使う。backend.md 8.2・8.3）
export type ActiveGoalRecord = {
  goal: Goal;
  created_at: string; // +09:00 付き。confirm のときの getNow()
  weekday_time_band: TimeBand | null;
  weekend_time_band: TimeBand | null;
};

// 有効な目標（status = 'active'。利用者ごとに最大1件）。なければ null
export async function getActiveGoalRecord(supabase: SupabaseClient): Promise<ActiveGoalRecord | null> {
  const { data, error } = await supabase
    .from("goals")
    .select("id, task_name, category, target_hours_per_week, frequency, deadline, priority, conditions, user_selected_plan, weekday_time_band, weekend_time_band, created_at")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    goal: GoalSchema.parse({
      ...data,
      // numeric は文字列で返ることがある
      target_hours_per_week: data.target_hours_per_week === null ? null : Number(data.target_hours_per_week),
      conditions: data.conditions ?? [],
      // date は "YYYY-MM-DD" の文字列で返る
    }),
    created_at: toJstIso(data.created_at),
    weekday_time_band: TimeBandSchema.nullable().parse(data.weekday_time_band),
    weekend_time_band: TimeBandSchema.nullable().parse(data.weekend_time_band),
  };
}

// 有効な目標（GoalSchema の形）。なければ null
export async function getActiveGoal(supabase: SupabaseClient): Promise<Goal | null> {
  return (await getActiveGoalRecord(supabase))?.goal ?? null;
}
