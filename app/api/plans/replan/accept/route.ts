import type { NextRequest } from "next/server";
import { ReplanAcceptRequestSchema } from "@/lib/schemas";
import { handle, HttpError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getDayView } from "@/lib/server/calendar";
import { applyReplan, getReplanProposalDate } from "@/lib/server/repositories/replan-proposals";

// POST /api/plans/replan/accept（plans-replan.md 12.6）：{ proposal_id } → 確定後のその日の DayView（11.3 の計算をかけたもの）。
// 古い提案（反映済み・期限切れ・計画が変わった）は 409 PROPOSAL_EXPIRED。「やめておく」は API を呼ばない
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const { proposal_id } = await parseBody(request, ReplanAcceptRequestSchema);

    const date = await getReplanProposalDate(supabase, proposal_id);
    if (!date) throw new HttpError(404, "NOT_FOUND", "提案が見つかりません");

    await applyReplan(supabase, proposal_id);
    return getDayView(supabase, user.id, date);
  });
}
