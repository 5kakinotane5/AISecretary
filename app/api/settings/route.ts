import { NextResponse, type NextRequest } from "next/server";
import { SettingsResponseSchema } from "@/lib/schemas";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { getState } from "@/lib/mock/store";
import { LOCATIONS, TRAVEL_TIMES, USER_PREFERENCE } from "@/mocks/persona";

// GET /api/settings（4章）：{ preferences, locations, travel_times, goal }
export async function GET(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  return NextResponse.json(
    SettingsResponseSchema.parse({
      preferences: USER_PREFERENCE,
      locations: LOCATIONS,
      travel_times: TRAVEL_TIMES,
      goal: getState().goal,
    }),
  );
}
