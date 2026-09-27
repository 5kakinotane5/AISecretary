import type { NextRequest } from "next/server";
import { MockResetResponseSchema } from "@/lib/schemas";
import { handle } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { requireDemoMode } from "@/lib/server/clock";
import { resetDemoUser } from "@/lib/server/seed";

// POST /api/mock/reset（backend.md 4.5）：デモモードのみ。ログイン中の利用者のデータを全部消して seed を入れ直す
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    requireDemoMode();
    const { user, supabase } = await requireUser();

    await resetDemoUser(supabase, user.id);

    return MockResetResponseSchema.parse({ ok: true });
  });
}
