import type { SupabaseClient } from "@supabase/supabase-js";
import { TaskSchema, type Task } from "@/lib/schemas";
import { toJstIso } from "@/lib/datetime";

// 自分のタスクの全件（completed を含む）。締切の早い順（締切なしは後ろ）→ 作成順。
// remaining_minutes は DB の値のまま（実施済みを引いた値は task-progress.ts で計算する）
export async function listTasks(supabase: SupabaseClient): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, goal_id, deadline_at, estimated_minutes, remaining_minutes, importance, concentration, splittable, interruptible, buffer_fit, status")
    .order("deadline_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((row) =>
    TaskSchema.parse({
      ...row,
      deadline_at: row.deadline_at === null ? null : toJstIso(row.deadline_at),
    }),
  );
}
