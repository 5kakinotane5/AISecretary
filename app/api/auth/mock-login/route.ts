import type { NextRequest } from "next/server";
import { MockLoginRequestSchema, MockLoginResponseSchema } from "@/lib/schemas";
import { handle, HttpError, parseBody } from "@/lib/server/http";
import { isDemoMode } from "@/lib/server/clock";
import { createClient } from "@/lib/server/supabase";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { seedDemoUser } from "@/lib/server/seed";

// POST /api/auth/mock-login（backend.md 4.5・5.2）：{ email: null } → { user_id, display_name }
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const body = await parseBody(request, MockLoginRequestSchema);
    if (body.email !== null) {
      throw new HttpError(400, "INVALID_REQUEST", "メールアドレスでのログインには対応していません"); // FR-01-6
    }

    const email = process.env.DEMO_USER_EMAIL;
    const password = process.env.DEMO_USER_PASSWORD;
    if (!email || !password) {
      throw new HttpError(500, "INTERNAL", "デモ用アカウントが設定されていません");
    }

    const supabase = await createClient();

    // 1. サインイン
    let { data, error } = await supabase.auth.signInWithPassword({ email, password });

    // 2. 失敗し、デモモードなら、アカウントを作ってからサインインし直す
    if (error && isDemoMode()) {
      const created = await createAdminClient().auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      ({ data, error } = await supabase.auth.signInWithPassword({ email, password }));
    }
    if (error || !data.user) {
      throw new HttpError(500, "INTERNAL", "ログインに失敗しました");
    }
    const userId = data.user.id;

    // 3. user_settings がなければ seed を入れる
    const settings = await supabase.from("user_settings").select("display_name").maybeSingle();
    if (settings.error) throw settings.error;
    const displayName = settings.data?.display_name ?? (await seedDemoUser(supabase, userId));

    return MockLoginResponseSchema.parse({ user_id: userId, display_name: displayName });
  });
}