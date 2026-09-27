import type { NextRequest } from "next/server";
import { CheckinRequestSchema, CheckinResponseSchema } from "@/lib/schemas";
import { handle, parseBody, requireValidDate } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getCheckin, upsertCheckin, type CheckinWrite } from "@/lib/server/repositories/daily-checkins";

// GET /api/checkin?date=YYYY-MM-DD（backend.md 9.3）：{ checkin }。なければ checkin: null
export async function GET(request: NextRequest) {
  return handle(request, async () => {
    const { supabase } = await requireUser();
    const date = requireValidDate(request.nextUrl.searchParams.get("date"));
    return CheckinResponseSchema.parse({ checkin: await getCheckin(supabase, date) });
  });
}

// POST /api/checkin（backend.md 9.3）：CheckinRequestSchema → { checkin }
// 同じ日は部分更新：省略した項目は前の値を残し、null を送った項目は null にする。
// text は note に保存するだけで、抽出はしない（FR-07-3）
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const body = await parseBody(request, CheckinRequestSchema);
    const date = requireValidDate(body.date);

    const values: CheckinWrite = {};
    if (body.mood !== undefined) values.mood = body.mood;
    if (body.fatigue !== undefined) values.fatigue = body.fatigue;
    if (body.concentration !== undefined) values.concentration = body.concentration;
    if (body.text !== undefined) values.note = body.text;

    return CheckinResponseSchema.parse({ checkin: await upsertCheckin(supabase, user.id, date, values) });
  });
}
