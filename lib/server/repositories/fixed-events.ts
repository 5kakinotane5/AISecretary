import type { SupabaseClient } from "@supabase/supabase-js";
import { FixedEventSchema, type FixedEvent } from "@/lib/schemas";
import { toJstIso } from "@/lib/datetime";

// 自分の固定予定の全件（展開前。毎週の予定は元の1件のまま）。start_at・end_at は +09:00 付き
export async function listFixedEvents(supabase: SupabaseClient): Promise<FixedEvent[]> {
  const { data, error } = await supabase
    .from("fixed_events")
    .select("id, title, category, location_id, start_at, end_at, recurrence");
  if (error) throw error;
  return data.map((row) =>
    FixedEventSchema.parse({ ...row, start_at: toJstIso(row.start_at), end_at: toJstIso(row.end_at) }),
  );
}
