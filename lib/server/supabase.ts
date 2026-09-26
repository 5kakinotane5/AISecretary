import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// ログイン中の利用者として Supabase に接続する（RLS が効く）
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component から呼ばれたときは set できない。proxy が更新するので無視してよい
          }
        },
      },
    },
  );
}