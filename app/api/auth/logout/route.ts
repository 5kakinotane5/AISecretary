import type { NextRequest } from "next/server";
import { OkResponseSchema } from "@/lib/schemas";
import { handle } from "@/lib/server/http";
import { createClient } from "@/lib/server/supabase";

// POST /api/auth/logout（FR-01-5）：{ ok: true }。/api/auth/* は401の対象外なので、未ログインでも ok を返す
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return OkResponseSchema.parse({ ok: true });
  });
}
