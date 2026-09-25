import type { z } from "zod";
import {
  DayViewSchema,
  GeneratePlansResponseSchema,
  InterviewConfirmResponseSchema,
  InterviewTurnSchema,
  MockLoginResponseSchema,
  PlanCandidatesResponseSchema,
  SelectPlanResponseSchema,
  SettingsResponseSchema,
  TasksResponseSchema,
  type DayView,
  type InterviewConfirmResponse,
  type InterviewMessageRequest,
  type InterviewTurn,
  type MockLoginResponse,
  type ScheduleCandidate,
  type SettingsResponse,
  type Task,
} from "./schemas";

// ---------- 画面から呼ぶ fetch 関数（mock-spec.md 1.4・4章・7章） ----------
// 画面（app/ の page や components/）は mocks/ を直接 import せず、必ずここを通してAPIからデータを受け取る。
// 画面のURLに ?mock_error=1 が付いていると、リクエストヘッダー x-mock-error: 1 を付けて送り、
// モックAPI側（lib/mock/http.ts）が500を返す。
// リクエスト・レスポンスの形は lib/schemas.ts に置く（10.19章）。サーバー側（app/api/）はこのファイルを import しない。

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

function post<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  return request(path, schema, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

/** POST /api/auth/mock-login（/login のスプラッシュからは常に email: null。10.11章） */
export function mockLogin(): Promise<MockLoginResponse> {
  return post("/api/auth/mock-login", MockLoginResponseSchema, { email: null });
}

/** POST /api/interview/start */
export function startInterview(): Promise<InterviewTurn> {
  return post("/api/interview/start", InterviewTurnSchema);
}

/** POST /api/interview/message（text と selection はどちらか一方だけ。10.2章） */
export function sendInterviewMessage(body: InterviewMessageRequest): Promise<InterviewTurn> {
  return post("/api/interview/message", InterviewTurnSchema, body);
}

/** POST /api/interview/confirm */
export function confirmInterview(sessionId: string): Promise<InterviewConfirmResponse> {
  return post("/api/interview/confirm", InterviewConfirmResponseSchema, { session_id: sessionId });
}

/** POST /api/plans/generate（利用者が「スケジュール作成」を押したときだけ呼ぶ） */
export async function generatePlans(sessionId: string): Promise<ScheduleCandidate[]> {
  const { candidates } = await post("/api/plans/generate", GeneratePlansResponseSchema, { session_id: sessionId });
  return candidates;
}

/** GET /api/plans/candidates（まだ生成していなければ空配列。10.19章） */
export async function fetchPlanCandidates(): Promise<ScheduleCandidate[]> {
  const { candidates } = await request("/api/plans/candidates", PlanCandidatesResponseSchema);
  return candidates;
}

/** POST /api/plans/{id}/select */
export async function selectPlan(planId: string): Promise<string> {
  const { active_plan_id } = await post(
    `/api/plans/${encodeURIComponent(planId)}/select`,
    SelectPlanResponseSchema,
  );
  return active_plan_id;
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

/** GET /api/settings */
export function fetchSettings(): Promise<SettingsResponse> {
  return request("/api/settings", SettingsResponseSchema);
}
