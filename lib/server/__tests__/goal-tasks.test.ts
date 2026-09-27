import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@/lib/schemas";
import {
  buildGoalTasks,
  mainMinutesFor,
  resolveGoalTaskNames,
  templateGoalTaskNames,
} from "@/lib/server/goal-task-template";

// 目標タスクのテンプレートと名前（backend.md 8.2）。
// fetch と環境変数はテストの中だけで差し替える（実際の OpenAI は呼ばない）

const GOAL: Goal = {
  id: "goal-1",
  task_name: "TOEIC学習",
  category: "資格・テスト勉強",
  target_hours_per_week: 6,
  frequency: null,
  deadline: "2026-12-13",
  priority: "medium",
  conditions: ["平日は夜が中心"],
  user_selected_plan: "balanced",
};
const WORKOUT: Goal = { ...GOAL, task_name: "筋トレ", category: "筋トレ・運動", deadline: null, conditions: [] };

function completion(content: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content), refusal: null } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function enableLlm() {
  vi.stubEnv("LLM_MODE", "on");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("OPENAI_MODEL", "test-model");
}

function mockLlm(names: { main: string; light: string | null }) {
  const fetchMock = vi.fn().mockResolvedValue(completion(names));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mainMinutesFor", () => {
  it("カテゴリごとのメインの時間（表にないカテゴリは「その他」）", () => {
    expect(mainMinutesFor("筋トレ・運動")).toBe(45);
    expect(mainMinutesFor("資格・テスト勉強")).toBe(60);
    expect(mainMinutesFor("未知のカテゴリ")).toBe(60);
  });
});

describe("buildGoalTasks", () => {
  it("資格・テスト勉強 → メインと軽作業版の2件", () => {
    const tasks = buildGoalTasks({
      category: "資格・テスト勉強",
      priority: "high",
      hoursPerWeek: 6,
      names: { main: "TOEIC リスニング演習", light: "TOEIC 単語" },
    });
    expect(tasks).toHaveLength(2);
    const [main, light] = tasks;
    expect(main).toMatchObject({
      title: "TOEIC リスニング演習",
      estimated_minutes: 60,
      remaining_minutes: 360,
      importance: "high",
      concentration: "medium",
      splittable: true,
      interruptible: true,
      buffer_fit: "low",
      deadline_at: null,
      status: "not_started",
    });
    expect(light).toMatchObject({
      title: "TOEIC 単語",
      estimated_minutes: 30,
      remaining_minutes: 360,
      importance: "high",
      concentration: "low",
      splittable: true,
      interruptible: true,
      buffer_fit: "high",
      deadline_at: null,
      status: "not_started",
    });
    expect(main.id).not.toBe(light.id);
    expect(main).not.toHaveProperty("goal_id");
  });

  it("筋トレ・運動 → メインだけの1件（light は使わない）", () => {
    const tasks = buildGoalTasks({
      category: "筋トレ・運動",
      priority: "medium",
      hoursPerWeek: 2.5,
      names: { main: "筋トレ", light: "使わない名前" },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "筋トレ",
      estimated_minutes: 45,
      remaining_minutes: 150,
      importance: "medium",
      concentration: "low",
      splittable: false,
      interruptible: false,
      buffer_fit: "low",
      deadline_at: null,
      status: "not_started",
    });
  });
});

describe("resolveGoalTaskNames", () => {
  it("LLM 成功 → その名前", async () => {
    enableLlm();
    const fetchMock = mockLlm({ main: "TOEIC リスニング演習", light: "TOEIC 単語" });

    expect(await resolveGoalTaskNames(GOAL)).toEqual({ main: "TOEIC リスニング演習", light: "TOEIC 単語" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.temperature).toBe(0.3);
    expect(body.response_format.json_schema.name).toBe("goal_task_names");
    expect(JSON.parse(body.messages[1].content)).toEqual({
      task_name: "TOEIC学習",
      category: "資格・テスト勉強",
      conditions: ["平日は夜が中心"],
      has_light: true,
    });
  });

  it("21文字の main → main だけテンプレート", async () => {
    enableLlm();
    mockLlm({ main: "あ".repeat(21), light: "TOEIC 単語" });

    expect(await resolveGoalTaskNames(GOAL)).toEqual({ main: templateGoalTaskNames("TOEIC学習").main, light: "TOEIC 単語" });
  });

  it("light がメインと同じ・null → light だけテンプレート", async () => {
    enableLlm();
    mockLlm({ main: "TOEIC 演習", light: " TOEIC 演習 " });
    expect(await resolveGoalTaskNames(GOAL)).toEqual({ main: "TOEIC 演習", light: "TOEIC学習 単語・復習" });

    mockLlm({ main: "TOEIC 演習", light: null });
    expect(await resolveGoalTaskNames(GOAL)).toEqual({ main: "TOEIC 演習", light: "TOEIC学習 単語・復習" });
  });

  it("軽作業版がないカテゴリ → light は null", async () => {
    enableLlm();
    mockLlm({ main: "筋トレ メニュー", light: "ストレッチ" });
    expect(await resolveGoalTaskNames(WORKOUT)).toEqual({ main: "筋トレ メニュー", light: null });
  });

  it("LlmError（HTTP 500）→ テンプレート", async () => {
    enableLlm();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));

    expect(await resolveGoalTaskNames(GOAL)).toEqual({ main: "TOEIC学習 演習", light: "TOEIC学習 単語・復習" });
    expect(await resolveGoalTaskNames(WORKOUT)).toEqual({ main: "筋トレ 演習", light: null });
  });

  it("LLM 無効 → fetch を呼ばず、テンプレート", async () => {
    vi.stubEnv("LLM_MODE", "off");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveGoalTaskNames(GOAL)).toEqual({ main: "TOEIC学習 演習", light: "TOEIC学習 単語・復習" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
