import { NextResponse, type NextRequest } from "next/server";
import { PlanCandidatesResponseSchema } from "@/lib/schemas";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { getState } from "@/lib/mock/store";
import { getPlanCandidates } from "@/lib/mock/plans";

// GET /api/plans/candidates（4章・10.19章）：{ candidates: ScheduleCandidate[] }
// POST /api/plans/generate の後なら同じ3案を返し、まだ生成していなければ空配列を返す。
export async function GET(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const candidates = getState().plans_generated ? getPlanCandidates() : [];
  return NextResponse.json(PlanCandidatesResponseSchema.parse({ candidates }));
}
