import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OkResponseSchema, TaskResponseSchema, TaskUpdateRequestSchema, type Task } from "@/lib/schemas";
import { handle, HttpError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getNow } from "@/lib/server/clock";
import { loadTaskDoneMinutes } from "@/lib/server/task-progress";
import { deleteTask, getTask, updateTask } from "@/lib/server/repositories/tasks";
import { MAX_REMAINING_MINUTES, requireTaskIdFormat, validateTaskValues } from "@/lib/server/task-input";

const notFound = () => new HttpError(404, "NOT_FOUND", "タスクが見つかりません");

// 変更・削除できるタスクを読む。ない（他人のタスクを含む）なら 404、目標タスクなら 400（FR-06-3）
async function requireEditableTask(supabase: SupabaseClient, id: string): Promise<Task> {
  requireTaskIdFormat(id);
  const task = await getTask(supabase, id);
  if (!task) throw notFound();
  if (task.goal_id !== null) throw new HttpError(400, "INVALID_REQUEST", "目標のタスクは変更・削除できません");
  return task;
}

// PATCH /api/tasks/{id}（backend.md 9.2）：TaskUpdateRequestSchema → { task }
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const { id } = await ctx.params;
    const values = await parseBody(request, TaskUpdateRequestSchema);
    if (Object.keys(values).length === 0) throw new HttpError(400, "INVALID_REQUEST", "変更する項目がありません");

    const now = await getNow(user.id, supabase);
    validateTaskValues(values, now);
    await requireEditableTask(supabase, id);

    // remaining_minutes は「入力値 ＋ 実施済み」を保存する（GET で返る値が入力値と一致するように。9.2）
    const done = await loadTaskDoneMinutes(supabase, now, id);
    const write = { ...values };
    if (values.remaining_minutes !== undefined) {
      write.remaining_minutes = values.remaining_minutes + done;
      if (write.remaining_minutes > MAX_REMAINING_MINUTES) {
        throw new HttpError(400, "INVALID_REQUEST", "実施済みの分と合わせて6000分を超えるため、残り時間を保存できません");
      }
    }

    const updated = await updateTask(supabase, id, write);
    if (!updated) throw notFound();
    // 応答は GET と同じく、実施済みを引いた残り
    return TaskResponseSchema.parse({
      task: { ...updated, remaining_minutes: Math.max(0, updated.remaining_minutes - done) },
    });
  });
}

// DELETE /api/tasks/{id}（backend.md 9.2）：{ ok: true }。計画の項目は残る（FR-06-5）
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  return handle(request, async () => {
    const { supabase } = await requireUser();
    const { id } = await ctx.params;
    await requireEditableTask(supabase, id);
    if (!(await deleteTask(supabase, id))) throw notFound();
    return OkResponseSchema.parse({ ok: true });
  });
}
