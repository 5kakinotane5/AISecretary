import { NextResponse, type NextRequest } from "next/server";
import { GeneratePlansRequestSchema, GeneratePlansResponseSchema } from "@/lib/schemas";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { getState, setInterviewState, setPlansGenerated } from "@/lib/mock/store";
import { getPlanCandidates } from "@/lib/mock/plans";

// POST /api/plans/generate（4章・10.3章）
// 選択に関わらず、5.9章の固定データ（TOEIC週6時間）をそのまま3案返す（モックの制限）。
// 生成したことを plans_generated に記録し、GET /api/plans/candidates から同じ3案を取れるようにする（10.19章）。
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(1500);

  const parsed = GeneratePlansRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || getState().interview_session_id !== parsed.data.session_id) {
    return NextResponse.json({ error: "session_id が無効です" }, { status: 400 });
  }

  setInterviewState("PLAN_PROPOSED");
  setPlansGenerated(true);

  return NextResponse.json(GeneratePlansResponseSchema.parse({ candidates: getPlanCandidates() }));
}
