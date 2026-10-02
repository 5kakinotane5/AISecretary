import type { NextRequest } from "next/server";
import { ReplanChatRequestSchema, ReplanChatResponseSchema } from "@/lib/schemas";
import { handle, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { loadReplanBase } from "@/lib/server/replan-base";
import { NOT_TODAY_MESSAGE } from "@/lib/server/replan-by-intent";
import { runReplanChat } from "@/lib/server/replan-chat/run";

// POST /api/plans/replan/chat（replan-chat.md 12.14）：ReplanChatRequest → ReplanChatResponse。
// 有効な計画がないときは 409（POST /api/plans/replan と同じ）
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const body = await parseBody(request, ReplanChatRequestSchema);

    const base = await loadReplanBase(supabase, user.id, body.date);
    if (!base.ok) {
      return ReplanChatResponseSchema.parse({
        message: NOT_TODAY_MESSAGE,
        proposals: [],
        selected_proposal_id: null,
        discarded: false,
        source: "fallback",
      });
    }

    return ReplanChatResponseSchema.parse(await runReplanChat(supabase, user.id, base, body));
  });
}
