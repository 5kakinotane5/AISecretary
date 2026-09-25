import { NextResponse, type NextRequest } from "next/server";
import { ScheduleCandidateSchema } from "@/lib/schemas";
import { z } from "zod";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { getState, setInterviewState } from "@/lib/mock/store";
import { INTENSIVE_PLAN } from "@/mocks/plans/intensive";
import { BALANCED_PLAN } from "@/mocks/plans/balanced";
import { RELAXED_PLAN } from "@/mocks/plans/relaxed";

const ResponseSchema = z.object({ candidates: z.array(ScheduleCandidateSchema).length(3) });

// POST /api/plans/generate（4章・10.3章）
// 選択に関わらず、5.9章の固定データ（TOEIC週6時間）をそのまま3案返す（モックの制限）。
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(1500);

  const body = await request.json().catch(() => null);
  const sessionId = body && typeof body === "object" ? (body as { session_id?: unknown }).session_id : undefined;
  const state = getState();
  if (typeof sessionId !== "string" || state.interview_session_id !== sessionId) {
    return NextResponse.json({ error: "session_id が無効です" }, { status: 400 });
  }

  setInterviewState("PLAN_PROPOSED");

  return NextResponse.json(ResponseSchema.parse({ candidates: [INTENSIVE_PLAN, BALANCED_PLAN, RELAXED_PLAN] }));
}
