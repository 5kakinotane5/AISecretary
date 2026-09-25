import { NextResponse, type NextRequest } from "next/server";
import { MockResetResponseSchema } from "@/lib/schemas";
import { isMockError, mockErrorResponse } from "@/lib/mock/http";
import { resetState } from "@/lib/mock/store";

// POST /api/mock/reset（4章）：状態をすべて初期値に戻す
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();

  resetState();
  return NextResponse.json(MockResetResponseSchema.parse({ ok: true }));
}
