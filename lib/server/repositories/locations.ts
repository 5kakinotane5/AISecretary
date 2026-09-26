import type { SupabaseClient } from "@supabase/supabase-js";
import { LocationSchema, type Location } from "@/lib/schemas";

// 表示の順（DB には順序がないため。モックの LOCATIONS と同じ並びになる）
const KIND_ORDER: Record<Location["kind"], number> = { home: 0, university: 1, work: 2, other: 3 };

// 自分の場所の全件。kind の順 → 名前順
export async function listLocations(supabase: SupabaseClient): Promise<Location[]> {
  const { data, error } = await supabase.from("locations").select("id, name, address, kind");
  if (error) throw error;
  return data
    .map((row) => LocationSchema.parse(row))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, "ja"));
}
