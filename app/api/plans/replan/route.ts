import type { NextRequest } from "next/server";
import { ReplanRequestSchema, ReplanResponseSchema } from "@/lib/schemas";
import { handle, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { loadReplanBase } from "@/lib/server/replan-base";
import { NOT_TODAY_MESSAGE, replanByIntent } from "@/lib/server/replan-by-intent";

// POST /api/plans/replan（plans-replan.md 12.1・12.2）：{ date, text } → ReplanProposal か { supported: false, message }
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const body = await parseBody(request, ReplanRequestSchema);

    // 1・2・5・6. 今日だけ（補正 C-12）・有効な計画・Before・PlanningContext（lib/server/replan-base.ts）
    const base = await loadReplanBase(supabase, user.id, body.date);
    if (!base.ok) return ReplanResponseSchema.parse({ supported: false, message: NOT_TODAY_MESSAGE });

    // 3・4・6〜10. 意図＋Engine（lib/server/replan-by-intent.ts）
    return replanByIntent(supabase, user.id, base, body.text);
  });
}
