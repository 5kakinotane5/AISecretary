import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callStructured, type CallStructuredOptions } from "@/lib/llm/client";
import type { DailyCheckin, ReplanChatLlm, ReplanChatResponse } from "@/lib/schemas";
import { runReplanChatTurn, toFallbackResponse, type ChatTurnDeps } from "@/lib/server/replan-chat/run";
import { chatFixture, idFactory, op, TODAY, type ChatFixture } from "@/lib/server/replan-chat/__tests__/helpers";
import type { EngineEventPayload } from "@/lib/engine-view/events";
import { buildParamSnapshot, computeFeatures } from "../snapshot";

// 会話の再計画の1ターンの出来事（lib/server/replan-chat/__tests__/run.test.ts と同じ作り方。LLM はモック）

vi.mock("@/lib/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/client")>();
  return { ...actual, callStructured: vi.fn() };
});

// 呼ばれたかを数えるため、snapshot の関数を本物を呼ぶ vi.fn で包む
vi.mock("../snapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../snapshot")>();
  return {
    ...actual,
    buildParamSnapshot: vi.fn(actual.buildParamSnapshot),
    computeFeatures: vi.fn(actual.computeFeatures),
    directionDistances: vi.fn(actual.directionDistances),
  };
});

const mockedCall = vi.mocked(callStructured);

function setupLlm(planReplies: ReplanChatLlm[]) {
  mockedCall.mockImplementation(async (options: CallStructuredOptions<unknown>) => {
    if (options.name === "replan_chat") {
      const next = planReplies.shift();
      if (!next) throw new Error("計画の呼び出しが多すぎます");
      return next;
    }
    if (options.name === "replan_chat_message") return { message: "おつかれさまです。案を用意しました。" };
    throw new Error(`想定していない呼び出し：${options.name}`);
  });
}

const llmReply = (value: Partial<ReplanChatLlm> & Pick<ReplanChatLlm, "reply_type">): ReplanChatLlm => ({
  options: [],
  select_index: null,
  text: null,
  fatigue: null,
  ...value,
});

const FALLBACK: ReplanChatResponse = toFallbackResponse({ supported: false, message: "fallback の返事" });

function deps(emit?: (event: EngineEventPayload) => void, overrides: Partial<ChatTurnDeps> = {}): ChatTurnDeps {
  return {
    llmEnabled: () => true,
    fallback: async () => FALLBACK,
    saveProposals: async () => {},
    discardProposals: async () => {},
    updateFatigue: async (fatigue): Promise<DailyCheckin> => ({
      date: TODAY, mood: null, fatigue, concentration: null, want_task_ids: [], avoid_task_ids: [], note: null,
    }),
    newId: idFactory("id"),
    elapsedMs: () => 0,
    ...(emit ? { emit } : {}),
    ...overrides,
  };
}

function run(fixture: ChatFixture, d: ChatTurnDeps, text: string) {
  return runReplanChatTurn(
    {
      request: { date: TODAY, text, history: [], open_proposal_ids: [] },
      context: fixture.context,
      beforeDays: fixture.beforeDays,
      openOptions: [],
      storedRows: new Map(),
      userId: "user-1",
      weeklyPlanId: "plan-1",
    },
    d,
  );
}

const tiredReply = () =>
  llmReply({
    reply_type: "proposal",
    fatigue: "high",
    options: [
      { label: "今夜は軽めにする", ops: [op({ op: "tired_plan" })] },
      { label: "仮眠してから続ける", ops: [op({ op: "add_rest", start: "now", minutes: 20, title: "仮眠" })] },
    ],
  });

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  mockedCall.mockReset();
  vi.mocked(buildParamSnapshot).mockClear();
  vi.mocked(computeFeatures).mockClear();
  vi.restoreAllMocks();
});

describe("runReplanChatTurn の出来事（emit）", () => {
  it("「今日は疲れた」：turn_start → llm_start → llm_result → state_update → option_check ×2 → turn_end", async () => {
    setupLlm([tiredReply()]);
    const events: EngineEventPayload[] = [];
    const response = await run(chatFixture(), deps((e) => events.push(e)), "今日は疲れた");

    expect(events.map((e) => e.type)).toEqual([
      "turn_start", "llm_start", "llm_result", "state_update", "option_check", "option_check", "turn_end",
    ]);
    expect(events.filter((e) => e.type === "state_update")).toHaveLength(1);

    const start = events[0] as Extract<EngineEventPayload, { type: "turn_start" }>;
    expect(start.text).toBe("今日は疲れた");
    expect(start.before_features).not.toBeNull();

    const result = events[2] as Extract<EngineEventPayload, { type: "llm_result" }>;
    expect(result).toMatchObject({ call: 1, reply_type: "proposal", fatigue: "high" });
    expect(result.options.map((o) => o.ops)).toEqual([["tired_plan"], ["add_rest 仮眠 now〜（20分）"]]);

    const update = events[3] as Extract<EngineEventPayload, { type: "state_update" }>;
    expect(update.before.checkin.fatigue).toBeNull();
    expect(update.after.checkin.fatigue).toBe("high");
    expect(update.after_features!.task_fit).toBeLessThan(start.before_features!.task_fit);

    const checks = events.filter((e): e is Extract<EngineEventPayload, { type: "option_check" }> => e.type === "option_check");
    expect(checks.map((c) => [c.call, c.index])).toEqual([[1, 1], [1, 2]]);
    for (const check of checks.filter((c) => c.ok)) {
      expect(check.after_features).not.toBeNull();
      expect(check.distances).not.toBeNull();
    }

    expect(events.at(-1)).toMatchObject({ type: "turn_end", reply_type: "proposal", proposals: response.proposals.length });
  }, 30_000);

  it("全部だめでやり直す：retry が出て、2回目の llm_start の feedback_count が入る。turn_end は1回だけ", async () => {
    setupLlm([
      llmReply({ reply_type: "proposal", options: [{ label: "明日に", ops: [op({ op: "postpone", item_id: "no-such-item" })] }] }),
      llmReply({ reply_type: "chat", text: "了解です" }),
    ]);
    const events: EngineEventPayload[] = [];
    await run(chatFixture(), deps((e) => events.push(e)), "明日に回して");
    expect(events.map((e) => e.type)).toEqual([
      "turn_start", "llm_start", "llm_result", "option_check", "retry", "llm_start", "llm_result", "turn_end",
    ]);
    expect(events[5]).toEqual({ type: "llm_start", call: 2, feedback_count: 1 });
    expect(events.at(-1)).toMatchObject({ type: "turn_end", reply_type: "chat", proposals: 0, message: "了解です" });
  });

  it("LLM_MODE=off：fallback（llm_off）→ turn_end（reply_type fallback）", async () => {
    const events: EngineEventPayload[] = [];
    await run(chatFixture(), deps((e) => events.push(e), { llmEnabled: () => false }), "今日は疲れた");
    expect(events.map((e) => e.type)).toEqual(["turn_start", "fallback", "turn_end"]);
    expect(events[1]).toEqual({ type: "fallback", reason: "llm_off" });
    expect(events[2]).toMatchObject({ reply_type: "fallback" });
  });

  it("emit を渡さないとき、snapshot の関数は呼ばれない（返事は同じ）", async () => {
    setupLlm([tiredReply()]);
    const withoutEmit = await run(chatFixture(), deps(), "今日は疲れた");
    expect(buildParamSnapshot).not.toHaveBeenCalled();
    expect(computeFeatures).not.toHaveBeenCalled();

    setupLlm([tiredReply()]);
    const withEmit = await run(chatFixture(), deps(() => {}), "今日は疲れた");
    expect(buildParamSnapshot).toHaveBeenCalled();
    expect(withEmit).toEqual(withoutEmit);
  }, 30_000);
});
