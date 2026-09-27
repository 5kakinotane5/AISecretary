import type { SupabaseClient } from "@supabase/supabase-js";
import { GoalSchema, TimeBandSchema, type Goal, type Task, type TimeBand } from "@/lib/schemas";
import { toJstIso } from "@/lib/datetime";
import { HttpError } from "../http";

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

// confirm で入れる目標タスク（目標の id・user_id・created_at は confirmGoalWithTasks が付ける）
export type GoalTaskWrite = Omit<Task, "goal_id">;

// 目標を確定する（confirm_goal を rpc。backend.md 4.4・8.1）。前の有効な目標は archived にし、その目標タスクを消す。
// confirm_goal は jsonb_populate_record で入れるので、JSON にない列は既定値ではなく null になる。
// そのため not null の列（id・user_id・status・created_at など）もすべて入れる。
// セッションがなければ HttpError(404)、それ以外の失敗はそのまま投げる（500）
export async function confirmGoalWithTasks(
  supabase: SupabaseClient,
  args: {
    userId: string;
    sessionId: string;
    goal: Goal;
    timeBands: { weekday: TimeBand | null; weekend: TimeBand | null };
    tasks: GoalTaskWrite[];
    now: string; // getNow()。goals・tasks の created_at に入れる
  },
): Promise<void> {
  const { userId, goal, now } = args;
  const goalRow = {
    id: goal.id,
    user_id: userId,
    task_name: goal.task_name,
    category: goal.category,
    target_hours_per_week: goal.target_hours_per_week,
    frequency: goal.frequency,
    deadline: goal.deadline,
    priority: goal.priority,
    conditions: goal.conditions,
    user_selected_plan: goal.user_selected_plan,
    weekday_time_band: args.timeBands.weekday,
    weekend_time_band: args.timeBands.weekend,
    status: "active",
    created_at: now,
  };
  const taskRows = args.tasks.map((t) => ({
    id: t.id,
    user_id: userId,
    title: t.title,
    goal_id: goal.id,
    deadline_at: t.deadline_at,
    estimated_minutes: t.estimated_minutes,
    remaining_minutes: t.remaining_minutes,
    importance: t.importance,
    concentration: t.concentration,
    splittable: t.splittable,
    interruptible: t.interruptible,
    buffer_fit: t.buffer_fit,
    status: t.status,
    created_at: now,
  }));

  const { error } = await supabase.rpc("confirm_goal", {
    p_session_id: args.sessionId,
    p_goal: goalRow,
    p_tasks: taskRows,
  });
  if (error?.message === "NOT_FOUND") throw new HttpError(404, "NOT_FOUND", "ヒアリングが見つかりません。最初からやり直してください");
  if (error) throw error;
}
