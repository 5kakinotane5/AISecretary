import type { SupabaseClient } from "@supabase/supabase-js";
import { TravelTimeSchema, type TravelTime } from "@/lib/schemas";

// 自分の移動時間表の全件（並びは不定。並べ替えは呼び出し側で行う）
export async function listTravelTimes(supabase: SupabaseClient): Promise<TravelTime[]> {
  const { data, error } = await supabase
    .from("travel_times")
    .select("from_location_id, to_location_id, minutes, mode, note");
  if (error) throw error;
  return data.map((row) => TravelTimeSchema.parse(row));
}
