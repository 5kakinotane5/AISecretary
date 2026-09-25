import { NextResponse, type NextRequest } from "next/server";
import { MockLoginRequestSchema, MockLoginResponseSchema } from "@/lib/schemas";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { PERSONA_DISPLAY_NAME } from "@/mocks/persona";

// POST /api/auth/mock-login（4章）：{ email: string | null } → { user_id, display_name }
export async function POST(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  const parsed = MockLoginRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  return NextResponse.json(MockLoginResponseSchema.parse({ user_id: "user_hikari", display_name: PERSONA_DISPLAY_NAME }));
}
