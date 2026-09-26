import type { SupabaseClient } from "@supabase/supabase-js";
import { DailyCheckinSchema, type DailyCheckin } from "@/lib/schemas";

const COLUMNS = "date, mood, fatigue, concentration, want_task_ids, avoid_task_ids, note";

// 書き込める列。省略した列は前の値を残す（backend.md 9.3）
export type CheckinWrite = Partial<Pick<DailyCheckin, "mood" | "fatigue" | "concentration" | "note">>;

function toCheckin(row: Record<string, unknown>): DailyCheckin {
  return DailyCheckinSchema.parse({
    ...row,
    want_task_ids: row.want_task_ids ?? [],
    avoid_task_ids: row.avoid_task_ids ?? [],
  });
}

// その日のチェックイン。なければ null
export async function getCheckin(supabase: SupabaseClient, date: string): Promise<DailyCheckin | null> {
  const { data, error } = await supabase.from("daily_checkins").select(COLUMNS).eq("date", date).maybeSingle();
  if (error) throw error;
  return data ? toCheckin(data) : null;
}

// その日のチェックインを入れる・変える（部分更新）。values にある列だけを書き、ない列は前の値を残す
// （初めての日は、ない列が null・空配列になる）
export async function upsertCheckin(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  values: CheckinWrite,
): Promise<DailyCheckin> {
  const { data, error } = await supabase
    .from("daily_checkins")
    .upsert({ user_id: userId, date, ...values }, { onConflict: "user_id,date" })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toCheckin(data);
}
