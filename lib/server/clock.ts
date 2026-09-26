import type { SupabaseClient } from "@supabase/supabase-js";
import { nowIsoJst, toJstIso } from "@/lib/datetime";
import { createClient } from "./supabase";

// user_settings.demo_now が null のときのデモ時刻（common.md 1.3）。seed もこれを使う
export const DEFAULT_DEMO_NOW = "2026-10-05T07:00:00+09:00";

// デモモードかどうか（common.md 1.3）
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

// 現在時刻（+09:00 付き ISO）。サーバーで「今」を知るのはここだけ（common.md 1.3）
// supabase は requireUser() のものを渡せる。省略時はここで作る
export async function getNow(userId: string, supabase?: SupabaseClient): Promise<string> {
  if (!isDemoMode()) return nowIsoJst();

  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("user_settings")
    .select("demo_now")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.demo_now ? toJstIso(data.demo_now) : DEFAULT_DEMO_NOW;
}
