import type { NextRequest } from "next/server";
import { ClockResponseSchema } from "@/lib/schemas";
import { handle } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getNow, isDemoMode } from "@/lib/server/clock";

// GET /api/clock（common.md 1.3）：常に有効（要ログイン）。画面が「今」を知る唯一の口
export async function GET(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const now = await getNow(user.id, supabase);
    return ClockResponseSchema.parse({ now, demo_mode: isDemoMode() });
  });
}
