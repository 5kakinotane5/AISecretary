import type { NextRequest } from "next/server";
import { InterviewTurnSchema } from "@/lib/schemas";
import { handle } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { FIRST_QUESTION } from "@/lib/server/interview-script";
import { EMPTY_SLOTS, startInterviewSession } from "@/lib/server/repositories/interview";

// POST /api/interview/start（backend.md 6.1 FR-02-1）：新しいセッションを作り、ステップ1（category）を返す。
// 進行中の古いセッションは ABANDONED にする。
// ステップ1の質問とクイックリプライは固定（6.2.2）なので、LLM_MODE にかかわらず同じ
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const { supabase } = await requireUser();
    const q = FIRST_QUESTION;
    const { session, messages } = await startInterviewSession(
      supabase,
      {
        state: "INTERVIEWING",
        step: q.step,
        step_index: q.step_index,
        retry_count: 0,
        slots: EMPTY_SLOTS,
        goal_candidates: null,
        goal_draft: null,
      },
      q.ai_message,
    );

    return InterviewTurnSchema.parse({
      session_id: session.id,
      state: "INTERVIEWING",
      step: q.step,
      step_index: q.step_index,
      messages,
      quick_replies: q.quick_replies,
      goal_candidates: null,
      goal_draft: null,
    });
  });
}
