import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { INTERVIEW_CATEGORIES, type Goal, type InterviewLlmSchema, type InterviewStep } from "@/lib/schemas";
import { LlmError } from "@/lib/llm/client";
import { buildGoalCandidates } from "@/lib/server/goal-candidates";
import { answerByLlm, checkExtracted, decideNext } from "@/lib/server/interview-llm";
import { buildSummaryMessage, PROVISIONAL_NOTE } from "@/lib/server/interview-summary";
import { EMPTY_SLOTS, type InterviewSession, type InterviewSlots } from "@/lib/server/repositories/interview";

// LLM_MODE=on のヒアリング（backend.md 6.2.2・6.2.3）。
// fetch と環境変数はテストの中だけで差し替える（実際の OpenAI は呼ばない）

const TODAY = "2026-10-05";

const RAW_EMPTY: z.infer<typeof InterviewLlmSchema>["extracted"] = {
  category: null,
  task_name: null,
  goal_text: null,
  current_status: null,
  deadline: null,
  conditions: [],
  explicit_hours_per_week: null,
  frequency_per_week: null,
  weekday_time_band: null,
  weekend_time_band: null,
};

function session(stepIndex: number, step: InterviewStep, slots: Partial<InterviewSlots> = {}, retryCount = 0): InterviewSession {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    state: "INTERVIEWING",
    step,
    step_index: stepIndex,
    retry_count: retryCount,
    slots: { ...EMPTY_SLOTS, ...slots },
    goal_candidates: null,
    goal_draft: null,
  };
}

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

// json_schema.name ごとに応答を返す fetch（ステップ4では3案の文章の LLM も呼ばれる）
function mockLlm(byName: Record<string, unknown>) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const name = JSON.parse(init.body as string).response_format.json_schema.name as string;
    if (!(name in byName)) return new Response("error", { status: 500 });
    return completion(byName[name]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const interviewReply = (extracted: Partial<typeof RAW_EMPTY>, rest: { next_message?: string; quick_replies?: string[]; user_said_unknown?: boolean } = {}) => ({
  extracted: { ...RAW_EMPTY, ...extracted },
  user_said_unknown: rest.user_said_unknown ?? false,
  next_message: rest.next_message ?? "次の質問です。",
  quick_replies: rest.quick_replies ?? [],
});

const noCandidates = vi.fn(async () => {
  throw new Error("not called");
});

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkExtracted", () => {
  it("16文字の task_name → null（15文字は通る）", () => {
    expect(checkExtracted({ ...RAW_EMPTY, task_name: "あ".repeat(16) }, TODAY).task_name).toBeNull();
    expect(checkExtracted({ ...RAW_EMPTY, task_name: " TOEIC学習 " }, TODAY).task_name).toBe("TOEIC学習");
    expect(checkExtracted({ ...RAW_EMPTY, task_name: "あ".repeat(15) }, TODAY).task_name).toBe("あ".repeat(15));
  });

  it("31文字の condition だけ落ちる。6件 → 先頭5件", () => {
    const long = "い".repeat(31);
    expect(checkExtracted({ ...RAW_EMPTY, conditions: ["平日は夜が中心", long, "土日は午前"] }, TODAY).conditions).toEqual([
      "平日は夜が中心",
      "土日は午前",
    ]);
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(checkExtracted({ ...RAW_EMPTY, conditions: six }, TODAY).conditions).toEqual(six.slice(0, 5));
  });

  it("今日より前・形の違う・実在しない deadline → null。今日以降はそのまま", () => {
    expect(checkExtracted({ ...RAW_EMPTY, deadline: "2026-10-04" }, TODAY).deadline).toBeNull();
    expect(checkExtracted({ ...RAW_EMPTY, deadline: "12/13" }, TODAY).deadline).toBeNull();
    expect(checkExtracted({ ...RAW_EMPTY, deadline: "2026-02-30" }, TODAY).deadline).toBeNull();
    expect(checkExtracted({ ...RAW_EMPTY, deadline: "2026-13-01" }, TODAY).deadline).toBeNull();
    expect(checkExtracted({ ...RAW_EMPTY, deadline: TODAY }, TODAY).deadline).toBe(TODAY);
    expect(checkExtracted({ ...RAW_EMPTY, deadline: "2026-12-13" }, TODAY).deadline).toBe("2026-12-13");
  });

  it("範囲外の数値だけ null（ほかの項目は残る）", () => {
    const result = checkExtracted(
      { ...RAW_EMPTY, category: "就活", explicit_hours_per_week: 100, frequency_per_week: 3, weekday_time_band: "evening" },
      TODAY,
    );
    expect(result).toMatchObject({
      category: "就活",
      explicit_hours_per_week: null,
      frequency_per_week: 3,
      weekday_time_band: "evening",
    });
  });
});

describe("decideNext", () => {
  it("ステップ1：category なし → 聞き直し、もう一度なし → その他で進む", () => {
    expect(decideNext(1, 0, EMPTY_SLOTS)).toEqual({ advance: false, slots: EMPTY_SLOTS });
    expect(decideNext(1, 1, EMPTY_SLOTS)).toEqual({ advance: true, slots: { ...EMPTY_SLOTS, category: "その他" } });
    const filled = { ...EMPTY_SLOTS, category: "就活" as const };
    expect(decideNext(1, 0, filled)).toEqual({ advance: true, slots: filled });
  });

  it("ステップ2：task_name なし3回 → 3回目で進む（task_name は null のまま）", () => {
    expect(decideNext(2, 0, EMPTY_SLOTS).advance).toBe(false);
    expect(decideNext(2, 1, EMPTY_SLOTS).advance).toBe(false);
    expect(decideNext(2, 2, EMPTY_SLOTS)).toEqual({ advance: true, slots: EMPTY_SLOTS });
  });

  it("ステップ3・4：常に進む", () => {
    expect(decideNext(3, 0, EMPTY_SLOTS).advance).toBe(true);
    expect(decideNext(4, 0, EMPTY_SLOTS).advance).toBe(true);
  });
});

describe("answerByLlm", () => {
  it("ステップ4で deadline null・conditions [] → step 6 で3案あり", async () => {
    enableLlm();
    const fetchMock = mockLlm({
      interview: interviewReply({ deadline: null, conditions: [] }, { user_said_unknown: true }),
    }); // 3案の文章（goal_candidate_texts）は 500 → テンプレート

    const s = session(4, "conditions", { category: "資格・テスト勉強", task_name: "TOEIC学習" });
    const answer = await answerByLlm({
      session: s,
      stepIndex: 4,
      text: "未定",
      recentMessages: [],
      today: TODAY,
      loadGoalCandidates: (slots) => buildGoalCandidates({ slots, today: TODAY, weeklyFreeMinutes: 2400, fixedEvents: [] }),
    });

    expect(answer.step).toBe("goal_candidates");
    expect(answer.step_index).toBe(6);
    expect(answer.retry_count).toBe(0);
    expect(answer.quick_replies).toEqual([]);
    expect(answer.goal_candidates?.map((c) => c.hours_per_week)).toEqual([9, 6, 3]); // 期限なし・資格は base 6
    expect(answer.slots.deadline).toBeNull();
    expect(answer.slots.conditions).toEqual([]);
    expect(answer.ai_message).toBe(
      "ありがとうございます。登録済みの授業・バイトの予定もふまえて、目標時間の案を3つ作りました。どれも正解・不正解はないので、しっくりくるものを選んでください。",
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.temperature).toBe(0);
    const input = JSON.parse(body.messages[1].content);
    expect(input.current_step).toBe("conditions");
    expect(input.next_step).toBe("time_estimation");
    expect(input.categories).toEqual([...INTERVIEW_CATEGORIES]);
  });

  it("ステップ4で期限あり → ステップ5の文に「M/Dまで約N週間です。」", async () => {
    enableLlm();
    mockLlm({ interview: interviewReply({ deadline: "2026-12-13", conditions: ["平日は夜が中心"], weekday_time_band: "evening", weekend_time_band: "evening" }) });

    const s = session(4, "conditions", { category: "資格・テスト勉強", task_name: "TOEIC学習" });
    const answer = await answerByLlm({
      session: s,
      stepIndex: 4,
      text: "12月13日に受験予定。夜が中心",
      recentMessages: [],
      today: TODAY,
      loadGoalCandidates: (slots) => buildGoalCandidates({ slots, today: TODAY, weeklyFreeMinutes: 2400, fixedEvents: [] }),
    });
    expect(answer.ai_message).toContain("ありがとうございます。12/13まで約10週間です。登録済みの");
    expect(answer.slots).toMatchObject({ deadline: "2026-12-13", weekday_time_band: "evening", weekend_time_band: "evening" });
  });

  it("ステップ3の回答 → LLM の質問。クイックリプライは21文字の案を落とし、最大5個で末尾が「未定」", async () => {
    enableLlm();
    const fetchMock = mockLlm({
      interview: interviewReply(
        { current_status: "前回は600点" },
        {
          next_message: " 受験日や、勉強しやすい時間帯はありますか？ ",
          quick_replies: ["12月に受験予定", "う".repeat(21), "未定", "平日は夜が中心", " 12月に受験予定 ", "", "土日の午前", "朝型です", "特になし"],
        },
      ),
    });

    const recent = [
      { role: "ai" as const, text: "具体的にはどんな目標ですか？" },
      { role: "user" as const, text: "TOEICで730点" },
    ];
    const answer = await answerByLlm({
      session: session(3, "current_status", { category: "資格・テスト勉強", task_name: "TOEIC学習" }),
      stepIndex: 3,
      text: "前回は600点",
      recentMessages: recent,
      today: TODAY,
      loadGoalCandidates: noCandidates,
    });

    expect(answer).toMatchObject({ step: "conditions", step_index: 4, retry_count: 0, goal_candidates: null });
    expect(answer.ai_message).toBe("受験日や、勉強しやすい時間帯はありますか？");
    expect(answer.quick_replies).toEqual(["12月に受験予定", "平日は夜が中心", "土日の午前", "朝型です", "未定"]);
    expect(answer.slots.current_status).toBe("前回は600点");
    expect(answer.slots.task_name).toBe("TOEIC学習"); // null では上書きしない
    expect(noCandidates).not.toHaveBeenCalled();

    const input = JSON.parse(JSON.parse(fetchMock.mock.calls[0][1].body as string).messages[1].content);
    expect(input.recent_messages).toEqual(recent); // 今回の発言は text で別に渡す
    expect(input.text).toBe("前回は600点");
    expect(input.next_step).toBe("conditions");
  });

  it("ステップ2の回答で進む → ステップ3の質問（「未定」は足さない）", async () => {
    enableLlm();
    mockLlm({ interview: interviewReply({ task_name: "TOEIC学習", goal_text: "TOEICで730点" }, { quick_replies: ["初めて受ける"] }) });

    const answer = await answerByLlm({
      session: session(2, "goal", { category: "資格・テスト勉強" }),
      stepIndex: 2,
      text: "TOEICで730点",
      recentMessages: [],
      today: TODAY,
      loadGoalCandidates: noCandidates,
    });
    expect(answer).toMatchObject({ step: "current_status", step_index: 3, quick_replies: ["初めて受ける"] });
  });

  it("ステップ1の聞き直し → 固定文とカテゴリ5つ。step は変えず retry_count +1", async () => {
    enableLlm();
    mockLlm({ interview: interviewReply({}, { next_message: "具体的な目標は？", quick_replies: ["TOEIC"], user_said_unknown: true }) });

    const answer = await answerByLlm({
      session: session(1, "category"),
      stepIndex: 1,
      text: "うーん",
      recentMessages: [],
      today: TODAY,
      loadGoalCandidates: noCandidates,
    });
    expect(answer).toMatchObject({
      step: "category",
      step_index: 1,
      retry_count: 1,
      ai_message: "すみません、うまく受け取れませんでした。いちばん近いものを選んでください。",
      quick_replies: [...INTERVIEW_CATEGORIES],
      goal_candidates: null,
    });
  });

  it("ステップ1の2回目も category なし → その他を slots に入れて進む", async () => {
    enableLlm();
    mockLlm({ interview: interviewReply({}, { next_message: "具体的にはどんな目標ですか？" }) });

    const answer = await answerByLlm({
      session: session(1, "category", {}, 1),
      stepIndex: 1,
      text: "うーん",
      recentMessages: [],
      today: TODAY,
      loadGoalCandidates: noCandidates,
    });
    expect(answer).toMatchObject({ step: "goal", step_index: 2, retry_count: 0, ai_message: "具体的にはどんな目標ですか？" });
    expect(answer.slots.category).toBe("その他");
  });

  it("ステップ2の聞き直し → 固定文・クイックリプライなし", async () => {
    enableLlm();
    mockLlm({ interview: interviewReply({}, { quick_replies: ["TOEIC"] }) });

    const answer = await answerByLlm({
      session: session(2, "goal", { category: "資格・テスト勉強" }, 1),
      stepIndex: 2,
      text: "分からない",
      recentMessages: [],
      today: TODAY,
      loadGoalCandidates: noCandidates,
    });
    expect(answer).toMatchObject({
      step: "goal",
      step_index: 2,
      retry_count: 2,
      ai_message: "目標を短い言葉で教えてください（例：TOEICで730点、週3回ジムに通う）。",
      quick_replies: [],
    });
  });

  it("LlmError（HTTP 500）→ そのまま投げる", async () => {
    enableLlm();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));

    await expect(
      answerByLlm({
        session: session(1, "category"),
        stepIndex: 1,
        text: "就活",
        recentMessages: [],
        today: TODAY,
        loadGoalCandidates: noCandidates,
      }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("次の質問が空 → LlmError", async () => {
    enableLlm();
    mockLlm({ interview: interviewReply({ category: "就活" }, { next_message: "  " }) });

    await expect(
      answerByLlm({
        session: session(1, "category"),
        stepIndex: 1,
        text: "就活",
        recentMessages: [],
        today: TODAY,
        loadGoalCandidates: noCandidates,
      }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});

describe("buildSummaryMessage（仮置き）", () => {
  const goal: Goal = {
    id: "goal-1",
    task_name: "目標",
    category: "その他",
    target_hours_per_week: 3,
    frequency: null,
    deadline: null,
    priority: "medium",
    conditions: [],
    user_selected_plan: "balanced",
  };

  it("provisional なら末尾に一文。なければ付けない", () => {
    expect(buildSummaryMessage(goal, [], TODAY, { provisional: true }).endsWith(`\n\n${PROVISIONAL_NOTE}`)).toBe(true);
    expect(buildSummaryMessage(goal, [], TODAY)).not.toContain(PROVISIONAL_NOTE);
  });
});
