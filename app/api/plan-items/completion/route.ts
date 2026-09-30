import type { NextRequest } from "next/server";
import { PlanItemCompletionRequestSchema, PlanItemCompletionResponseSchema } from "@/lib/schemas";
import { getNow } from "@/lib/server/clock";
import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, parseBody, requireValidDate } from "@/lib/server/http";
import { setActivePlanTaskCompletion } from "@/lib/server/repositories/plans";
import { toDateStr } from "@/lib/datetime";

// PATCH /api/plan-items/completion：有効な計画にある今日のタスク枠を完了／未完了にする
export async function PATCH(request: NextRequest) {
  return handle(request, async () => {
    const input = await parseBody(request, PlanItemCompletionRequestSchema);
    const date = requireValidDate(input.date);
    const { user, supabase } = await requireUser();
    const now = await getNow(user.id, supabase);
    if (date !== toDateStr(now)) {
      throw new HttpError(409, "INVALID_STATE", "今日のタスクだけ完了状態を変更できます");
    }
    const status = await setActivePlanTaskCompletion(supabase, input.item_id, date, input.completed);
    return PlanItemCompletionResponseSchema.parse({ item_id: input.item_id, status });
  });
}
