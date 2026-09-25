import { z } from "zod";
import { DayViewSchema, TaskSchema, type DayView, type Task } from "./schemas";

// ---------- 画面から呼ぶ fetch 関数（mock-spec.md 1.4・4章・7章） ----------
// 画面（app/ の page や components/）は mocks/ を直接 import せず、必ずここを通してAPIからデータを受け取る。
// 画面のURLに ?mock_error=1 が付いていると、リクエストヘッダー x-mock-error: 1 を付けて送り、
// モックAPI側（lib/mock/http.ts）が500を返す。

/** GET /api/tasks のレスポンス。Route Handler（app/api/tasks/route.ts）でも同じものを使う */
export const TasksResponseSchema = z.object({ tasks: z.array(TaskSchema) });

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function mockErrorRequested(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("mock_error") === "1";
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  if (mockErrorRequested()) headers.set("x-mock-error", "1");

  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    throw new ApiError(response.status, `APIの呼び出しに失敗しました（${response.status}）`);
  }
  return schema.parse(await response.json());
}

/** GET /api/tasks */
export async function fetchTasks(): Promise<Task[]> {
  const { tasks } = await request("/api/tasks", TasksResponseSchema);
  return tasks;
}

/** GET /api/calendar/day?date= */
export function fetchCalendarDay(date: string): Promise<DayView> {
  return request(`/api/calendar/day?date=${encodeURIComponent(date)}`, DayViewSchema);
}
