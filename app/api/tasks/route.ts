import type { NextRequest } from "next/server";
import { TaskCreateRequestSchema, TaskResponseSchema, TasksResponseSchema } from "@/lib/schemas";
import { handle, HttpError, parseValue, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getNow } from "@/lib/server/clock";
import { loadTaskProgress } from "@/lib/server/task-progress";
import { insertTask } from "@/lib/server/repositories/tasks";
import { validateTaskValues } from "@/lib/server/task-input";

// GET /api/tasks（backend.md 9.2・8.3）：{ tasks: Task[] }
// status != completed のタスク。remaining_minutes は実施済みを引いた値（目標タスクは今週の残り R）
export async function GET(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const now = await getNow(user.id, supabase);
    const { tasks } = await loadTaskProgress(supabase, now);
    return TasksResponseSchema.parse({ tasks });
  });
}

// POST /api/tasks（backend.md 9.2）：TaskCreateRequestSchema → { task }
// 目標タスクは作れない（目標の確定でだけ作る。FR-06-3）
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const raw = await readJson(request);
    // Zod はスキーマにないキーを捨てるので、goal_id は元の本文で見る
    if (raw && typeof raw === "object" && "goal_id" in raw && (raw as { goal_id: unknown }).goal_id !== null) {
      throw new HttpError(400, "INVALID_REQUEST", "目標のタスクは登録できません");
    }
    const body = parseValue(raw, TaskCreateRequestSchema);
    validateTaskValues(body, await getNow(user.id, supabase));

    // 新しいタスクには実施済みがないので、remaining_minutes は DB の値がそのまま残り
    const task = await insertTask(supabase, { ...body, status: "not_started" });
    return TaskResponseSchema.parse({ task });
  });
}
