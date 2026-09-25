import { NextResponse, type NextRequest } from "next/server";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { PERSONA_DISPLAY_NAME } from "@/mocks/persona";

// POST /api/auth/mock-login（4章）：{ email: string | null } → { user_id, display_name }
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const body = await request.json().catch(() => ({}));
  if (typeof body !== "object" || body === null || !("email" in body)) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  return NextResponse.json({ user_id: "user_hikari", display_name: PERSONA_DISPLAY_NAME });
}
