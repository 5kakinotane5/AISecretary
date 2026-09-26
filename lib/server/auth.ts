import { createClient } from "./supabase";
import { HttpError } from "./http";

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "ログインしてください");
  return { user, supabase };
}
