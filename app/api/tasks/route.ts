import { NextResponse, type NextRequest } from "next/server";
import { TasksResponseSchema } from "@/lib/api";
import { isMockError, mockDelay, mockErrorResponse } from "@/lib/mock/http";
import { TASKS } from "@/mocks/tasks";

// GET /api/tasks（4章・10.17章）：{ tasks: Task[] }
// 締切バッジやバッファの候補タスク名など、画面がタスクの情報を必要とするときに使う
export async function GET(request: NextRequest) {
  if (isMockError(request)) return mockErrorResponse();
  await mockDelay(400);

  return NextResponse.json(TasksResponseSchema.parse({ tasks: TASKS }));
}
