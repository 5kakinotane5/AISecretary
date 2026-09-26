import type { NextRequest } from "next/server";
import { SettingsResponseSchema } from "@/lib/schemas";
import { handle, HttpError } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getUserPreference } from "@/lib/server/repositories/user-settings";
import { listLocations } from "@/lib/server/repositories/locations";
import { listTravelTimes } from "@/lib/server/repositories/travel-times";
import { getActiveGoal } from "@/lib/server/repositories/goals";

// GET /api/settings（backend.md 9.1、common.md 3.2）：{ preferences, locations, travel_times, goal }
// goal は有効な目標。確定前は null
export async function GET(request: NextRequest) {
  return handle(request, async () => {
    const { supabase } = await requireUser();
    const [preferences, locations, travelTimes, goal] = await Promise.all([
      getUserPreference(supabase),
      listLocations(supabase),
      listTravelTimes(supabase),
      getActiveGoal(supabase),
    ]);
    if (!preferences) {
      throw new HttpError(409, "INVALID_STATE", "設定が見つかりません。ログインし直してください");
    }

    // 移動時間表は、出発地 → 到着地の順に、場所の並びで並べる
    const order = new Map(locations.map((l, i) => [l.id, i]));
    const rank = (id: string) => order.get(id) ?? locations.length;
    const travel_times = [...travelTimes].sort(
      (a, b) => rank(a.from_location_id) - rank(b.from_location_id) || rank(a.to_location_id) - rank(b.to_location_id),
    );

    return SettingsResponseSchema.parse({ preferences, locations, travel_times, goal });
  });
}
