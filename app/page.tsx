import { redirect } from "next/navigation";
import { createClient } from "@/lib/server/supabase";

// backend.md 5.2（補正 C-3）：/ はログイン済みなら /today、未ログインなら /login へリダイレクトする
export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? "/today" : "/login");
}
