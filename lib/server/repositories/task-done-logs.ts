import type { SupabaseClient } from "@supabase/supabase-js";

// 計画を選び直す前に実施済みだった分（backend.md 8.2）
export type TaskDoneLog = { task_id: string; date: string; minutes: number };

// 自分の task_done_logs の全件
export async function listTaskDoneLogs(supabase: SupabaseClient): Promise<TaskDoneLog[]> {
  const { data, error } = await supabase.from("task_done_logs").select("task_id, date, minutes");
  if (error) throw error;
  return data.map((row) => ({ task_id: row.task_id, date: row.date, minutes: row.minutes }));
}
