import type { SupabaseClient } from "@supabase/supabase-js";
import { PlanningContextSchema, type PlanningContext, type PlanStyle, type ScheduleItem } from "@/lib/schemas";
import { addDays, getWeekStart, toDateStr } from "@/lib/datetime";
import { expandFixedEvents } from "@/lib/planning/skeleton";
import { getNow } from "./clock";
import { HttpError } from "./http";
import { loadTaskProgress } from "./task-progress";
import { getCheckin } from "./repositories/daily-checkins";
import { listFixedEvents } from "./repositories/fixed-events";
import { listLocations } from "./repositories/locations";
import { getActivePlan, listPlanItems } from "./repositories/plans";
import { listTravelTimes } from "./repositories/travel-times";
import { getHomeLocationId, getUserPreference } from "./repositories/user-settings";

// Planning Engine の入力を DB から組み立てる（backend.md 8.3）。
// 会話の文章（interview_messages・slots）は含めない（FR-04-2）

// 生成のときの locked_items：有効な計画が今週のものなら、過去の項目と明示的に完了した項目（8.3）。
// 作り直しても過去の枠・完了状態を変えない。経過しただけでは完了扱いしない
async function loadLockedItems(supabase: SupabaseClient, weekStart: string, now: string): Promise<ScheduleItem[]> {
  const active = await getActivePlan(supabase);
  if (!active || active.week_start !== weekStart) return [];
  const entries = (await listPlanItems(supabase, [active.id])).get(active.id) ?? [];
  return entries
    .map((e) => e.item)
    .filter((item) => item.end_at <= now || item.status === "completed")
    .map((item) => ({ ...item, locked: true }));
}

// style：生成は null、再計画は有効な計画の style
export async function buildPlanningContext(
  supabase: SupabaseClient,
  userId: string,
  style: PlanStyle | null,
): Promise<PlanningContext> {
  const now = await getNow(userId, supabase);
  const today = toDateStr(now);
  const weekStart = getWeekStart(today);

  const [preferences, homeLocationId, locations, travelTimes, fixedEvents, progress, checkin, lockedItems] =
    await Promise.all([
      getUserPreference(supabase),
      getHomeLocationId(supabase),
      listLocations(supabase),
      listTravelTimes(supabase),
      listFixedEvents(supabase),
      loadTaskProgress(supabase, now),
      getCheckin(supabase, today),
      loadLockedItems(supabase, weekStart, now),
    ]);
  if (!preferences || !homeLocationId) {
    throw new HttpError(409, "INVALID_STATE", "設定が見つかりません。ログインし直してください");
  }

  const goal = progress.goal;
  return PlanningContextSchema.parse({
    now,
    week_start: weekStart,
    style,
    preferences,
    home_location_id: homeLocationId,
    locations,
    travel_times: travelTimes,
    fixed_events: expandFixedEvents(fixedEvents, weekStart, addDays(weekStart, 6), { purpose: "planning_context" }),
    goals: goal ? [goal.goal] : [],
    goal_week_target_minutes: progress.goal_week_target_minutes,
    goal_done_minutes: progress.goal_done_minutes,
    goal_time_bands: goal ? { [goal.goal.id]: { weekday: goal.weekday_time_band, weekend: goal.weekend_time_band } } : {},
    // 残りが0になったタスクは Engine に渡さない（8.3）
    tasks: progress.tasks.filter((t) => t.remaining_minutes > 0),
    checkin,
    locked_items: lockedItems,
  });
}
