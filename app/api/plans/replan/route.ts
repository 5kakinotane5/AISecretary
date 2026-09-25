import { NextResponse, type NextRequest } from "next/server";
import { ReplanProposalSchema } from "@/lib/schemas";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { advanceToEighteenIfBefore } from "@/lib/mock/clock";
import { REPLAN_TIRED } from "@/mocks/replan-tired";

const UNSUPPORTED_MESSAGE = "このデモでは「今日は疲れた」のみ対応しています";

// POST /api/plans/replan（4章・2.5章）
// モックで結果を返せるのは「今日は疲れた」とその言い換え（「疲れた」を含む文）だけ。
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(1200);

  const body = await request.json().catch(() => null);
  const date = body && typeof body === "object" ? (body as { date?: unknown }).date : undefined;
  const text = body && typeof body === "object" ? (body as { text?: unknown }).text : undefined;
  if (typeof date !== "string" || typeof text !== "string") {
    return NextResponse.json({ error: "date と text は必須です" }, { status: 400 });
  }

  // 10.6章：POST /api/plans/replan 側でも念のため18:00への繰り上げを行う（二重に呼ばれても副作用はない）
  advanceToEighteenIfBefore();

  if (date === REPLAN_TIRED.date && text.includes("疲れた")) {
    return NextResponse.json(ReplanProposalSchema.parse(REPLAN_TIRED));
  }

  return NextResponse.json({ supported: false, message: UNSUPPORTED_MESSAGE });
}
