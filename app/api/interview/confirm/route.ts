import type { NextRequest } from "next/server";
import { InterviewConfirmRequestSchema, InterviewConfirmResponseSchema } from "@/lib/schemas";
import { handle, HttpError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getNow } from "@/lib/server/clock";
import { SCRIPT_GOAL_TASKS } from "@/lib/server/interview-script";
import { getInterviewSession } from "@/lib/server/repositories/interview";
import { confirmGoalWithTasks } from "@/lib/server/repositories/goals";
// POST /api/interview/confirm（backend.md 6.2.4・8.1、FR-02-7）：{ session_id } → { state: "READY_FOR_PLANNING", goal }
// 目標と目標タスクを保存し、状態を READY_FOR_PLANNING にする。スケジュールは作らない
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const body = await parseBody(request, InterviewConfirmRequestSchema);

    const session = await getInterviewSession(supabase, body.session_id);
    if (!session) throw new HttpError(404, "NOT_FOUND", "ヒアリングが見つかりません。最初からやり直してください");
    if (session.state !== "CONFIRMING" || session.goal_draft === null) {
      throw new HttpError(409, "INVALID_STATE", "確定できる目標がありません");
    }
    const goal = session.goal_draft;
    const hours = goal.target_hours_per_week;
    if (hours === null) throw new HttpError(409, "INVALID_STATE", "確定できる目標がありません"); // FR-04-5：selection で必ず入る

    // 目標タスク（6.2.6：台本では mocks/tasks.ts の G1 の2件と同じ名前・属性）。
    // TODO: LLM_MODE=on のときは 8.2 のカテゴリ別テンプレートと LLM の名前（lib/llm/goal-task-names.ts）で作る
    const tasks = SCRIPT_GOAL_TASKS.map((t) => ({
      ...t,
      id: crypto.randomUUID(),
      remaining_minutes: hours * 60, // DB には target_hours_per_week × 60 を入れる（8.2）
    }));

    await confirmGoalWithTasks(supabase, {
      userId: user.id,
      sessionId: session.id,
      goal,
      timeBands: { weekday: session.slots.weekday_time_band, weekend: session.slots.weekend_time_band },
      tasks,
      now: await getNow(user.id, supabase),
    });

    return InterviewConfirmResponseSchema.parse({ state: "READY_FOR_PLANNING", goal });
  });
}
