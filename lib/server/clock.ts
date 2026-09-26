import type { SupabaseClient } from "@supabase/supabase-js";
import { nowIsoJst, toJstIso } from "@/lib/datetime";
import { createClient } from "./supabase";
// http.ts もこのファイルを import している（循環）。どちらも関数の中でしか使わないので問題ない
import { HttpError } from "./http";

// user_settings.demo_now が null のときのデモ時刻（common.md 1.3）。seed もこれを使う
export const DEFAULT_DEMO_NOW = "2026-10-05T07:00:00+09:00";

// デモモードかどうか（common.md 1.3）
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

// /api/mock/* の最初に呼ぶ。デモモードでなければ404（common.md 1.3）
export function requireDemoMode(): void {
  if (!isDemoMode()) throw new HttpError(404, "NOT_FOUND", "見つかりません");
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

// デモ時刻（user_settings.demo_now）を書き換える。書き込んだ時刻を +09:00 付き ISO で返す
export async function setDemoNow(userId: string, supabase: SupabaseClient, now: string): Promise<string> {
  const { data, error } = await supabase
    .from("user_settings")
    .update({ demo_now: now })
    .eq("user_id", userId)
    .select("demo_now");
  if (error) throw error;
  if (data.length === 0) {
    throw new HttpError(409, "INVALID_STATE", "設定が見つかりません。ログインし直してください");
  }
  return toJstIso(data[0].demo_now);
}
