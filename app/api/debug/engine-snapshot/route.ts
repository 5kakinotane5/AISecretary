import type { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { isEngineViewEnabled } from "@/lib/server/engine-view/bus";
import { buildCurrentView } from "@/lib/server/engine-view/checkin";
import { loadEngineViewBase } from "@/lib/server/engine-view/load";

// GET /api/debug/engine-snapshot（発表用。ENGINE_VIEW=on のときだけ）：今の値を返す。
// 別画面を開いたとき・つなぎ直したときの「待機中」の表示に使う。DB には書かず、出来事も送らない。
// 計算はチェックインの turn_start と同じ（buildCurrentView）。有効な計画がないときは today_fits が空、features・distances が null
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handle(request, async () => {
    if (!isEngineViewEnabled()) throw new HttpError(404, "NOT_FOUND", "見つかりません");
    const { user, supabase } = await requireUser();
    return buildCurrentView(await loadEngineViewBase(supabase, user.id));
  });
}
