import type { NextRequest } from "next/server";
import { MockClockResponseSchema } from "@/lib/schemas";
import { toDateStr } from "@/lib/datetime";
import { handle, HttpError } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getNow, requireDemoMode, setDemoNow } from "@/lib/server/clock";
import { setDemoNow as setMockDemoNow } from "@/lib/mock/store";

// GET /api/mock/clock（common.md 1.3）：デモモードのみ。今のデモ時刻 { now }（互換のため残す。画面は /api/clock を使う）
export async function GET(request: NextRequest) {
  return handle(request, async () => {
    requireDemoMode();
    const { user, supabase } = await requireUser();
    return MockClockResponseSchema.parse({ now: await getNow(user.id, supabase) });
  });
}

// POST /api/mock/clock（common.md 1.3）：デモモードのみ。user_settings.demo_now を書く
// { now } が指定されればその時刻にする（/settings のデモ時刻切り替え、/replan の18:00への繰り上げ）。
// 指定が無ければ、今が18:00より前なら同じ日の18:00に進める（すでに18:00以降なら何もしない）。
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    requireDemoMode();
    const { user, supabase } = await requireUser();

    const body: unknown = await request.json().catch(() => ({}));
    const requested = body && typeof body === "object" ? (body as { now?: unknown }).now : undefined;
    if (requested !== undefined && requested !== null) {
      if (typeof requested !== "string" || Number.isNaN(new Date(requested).getTime())) {
        throw new HttpError(400, "INVALID_REQUEST", "時刻の形が正しくありません");
      }
    }

    let now: string;
    if (typeof requested === "string") {
      now = await setDemoNow(user.id, supabase, requested);
    } else {
      const current = await getNow(user.id, supabase);
      const eighteen = `${toDateStr(current)}T18:00:00+09:00`;
      now = current < eighteen ? await setDemoNow(user.id, supabase, eighteen) : current;
    }

    // TODO: 全APIを本番化したら削除。/api/plans/replan がまだモックの時刻（lib/mock/clock.ts）を使うため、
    // 同じ値にそろえておく（common.md 1.6「モックの状態と DB を混ぜない」の一時的な例外）
    setMockDemoNow(now);

    return MockClockResponseSchema.parse({ now });
  });
}
