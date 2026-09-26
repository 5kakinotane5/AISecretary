import type { SupabaseClient } from "@supabase/supabase-js";
import { TaskSchema, type Task } from "@/lib/schemas";
import { toJstIso } from "@/lib/datetime";

const COLUMNS =
  "id, title, goal_id, deadline_at, estimated_minutes, remaining_minutes, importance, concentration, splittable, interruptible, buffer_fit, status";

// DB の行 → Task。deadline_at は +09:00 付きにする
function toTask(row: Record<string, unknown>): Task {
  return TaskSchema.parse({
    ...row,
    deadline_at: typeof row.deadline_at === "string" ? toJstIso(row.deadline_at) : null,
  });
}

// 書き込める列（id・goal_id・user_id・created_at は API から変えない）
export type TaskWrite = Partial<Omit<Task, "id" | "goal_id">>;

// 自分のタスクの全件（completed を含む）。締切の早い順（締切なしは後ろ）→ 作成順。
// remaining_minutes は DB の値のまま（実施済みを引いた値は task-progress.ts で計算する）
export async function listTasks(supabase: SupabaseClient): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(COLUMNS)
    .order("deadline_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map(toTask);
}

// 自分のタスク1件。なければ（他人のタスクも RLS で見えないので）null
export async function getTask(supabase: SupabaseClient, id: string): Promise<Task | null> {
  const { data, error } = await supabase.from("tasks").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toTask(data) : null;
}

// 目標タスク以外を1件入れる（goal_id は null。user_id は既定値 auth.uid()）
export async function insertTask(supabase: SupabaseClient, values: Omit<Task, "id" | "goal_id">): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({ id: crypto.randomUUID(), goal_id: null, ...values })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toTask(data);
}

// 1件を変える。対象がなければ（0行なら）null
export async function updateTask(supabase: SupabaseClient, id: string, values: TaskWrite): Promise<Task | null> {
  const { data, error } = await supabase.from("tasks").update(values).eq("id", id).select(COLUMNS);
  if (error) throw error;
  return data.length > 0 ? toTask(data[0]) : null;
}

// 1件を消す。消せたら true（0行なら false）。計画の項目の task_id は外部キーで null になる
export async function deleteTask(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("tasks").delete().eq("id", id).select("id");
  if (error) throw error;
  return data.length > 0;
}
