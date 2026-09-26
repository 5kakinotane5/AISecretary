import type { NextRequest } from "next/server";
import { CheckinRequestSchema, CheckinResponseSchema } from "@/lib/schemas";
import { handle, HttpError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getCheckin, upsertCheckin, type CheckinWrite } from "@/lib/server/repositories/daily-checkins";

// YYYY-MM-DD の実在する日付か（2026-02-30 などは不可）
function isValidDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === date;
}

function requireValidDate(date: string | null): string {
  if (date === null || !isValidDate(date)) {
    throw new HttpError(400, "INVALID_REQUEST", "日付は YYYY-MM-DD の形で指定してください");
  }
  return date;
}

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
