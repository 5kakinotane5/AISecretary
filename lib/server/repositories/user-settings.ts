import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { UserPreferenceSchema } from "@/lib/schemas";

// user_settings の生活リズム（UserPreferenceSchema の形）。行がなければ null
export async function getUserPreference(
  supabase: SupabaseClient,
): Promise<z.infer<typeof UserPreferenceSchema> | null> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("sleep_start, sleep_end, daily_work_limit_minutes, min_buffer_minutes, min_daily_buffer_minutes")
    .maybeSingle();
  if (error) throw error;
  return data ? UserPreferenceSchema.parse(data) : null;
}

// 家の場所の id（PlanningContext の home_location_id）。行がなければ null
export async function getHomeLocationId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.from("user_settings").select("home_location_id").maybeSingle();
  if (error) throw error;
  return data?.home_location_id ?? null;
}
