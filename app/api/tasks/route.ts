import type { NextRequest } from "next/server";
import { TasksResponseSchema } from "@/lib/schemas";
import { handle } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getNow } from "@/lib/server/clock";
import { loadTaskProgress } from "@/lib/server/task-progress";

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
