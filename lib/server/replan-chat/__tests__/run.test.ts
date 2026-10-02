import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callStructured, LlmError, type CallStructuredOptions } from "@/lib/llm/client";
import { replan } from "@/lib/planning/replan";
import type { DailyCheckin, ReplanChatLlm, ReplanChatResponse } from "@/lib/schemas";
import { buildReplanChatInput } from "@/lib/llm/replan-chat";
import { buildProposalInsert, runReplanChatTurn, toFallbackResponse, type ChatTurnDeps, type SavedProposal } from "../run";
import { chatFixture, findBefore, idFactory, op, TODAY, type ChatFixture } from "./helpers";

// 会話の再計画の1ターン（replan-chat.md 12.11・12.15）。callStructured だけを差し替える（実際の OpenAI は呼ばない）

vi.mock("@/lib/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/client")>();
  return { ...actual, callStructured: vi.fn() };
});

const mockedCall = vi.mocked(callStructured);

type PlanReply = ReplanChatLlm | LlmError;

// 計画の呼び出しは planReplies を順に返し、受け取った user の JSON を planInputs に残す。説明の呼び出しは message を返す
function setupLlm(planReplies: PlanReply[], message: string | LlmError = "おつかれさまです。案を用意しました。") {
  const planInputs: Record<string, unknown>[] = [];
  mockedCall.mockImplementation(async (options: CallStructuredOptions<unknown>) => {
    if (options.name === "replan_chat") {
      planInputs.push(JSON.parse(options.user));
      const next = planReplies.shift();
      if (!next) throw new Error("計画の呼び出しが多すぎます");
      if (next instanceof LlmError) throw next;
      return next;
    }
    if (options.name === "replan_chat_message") {
      if (message instanceof LlmError) throw message;
      return { message };
    }
    throw new Error(`想定していない呼び出し：${options.name}`);
  });
  return { planInputs };
}

const llmReply = (value: Partial<ReplanChatLlm> & Pick<ReplanChatLlm, "reply_type">): ReplanChatLlm => ({
  options: [],
  select_index: null,
  text: null,
  fatigue: null,
  ...value,
});

const FALLBACK: ReplanChatResponse = toFallbackResponse({ supported: false, message: "fallback の返事" });

function deps(overrides: Partial<ChatTurnDeps> = {}) {
  const saved: SavedProposal[][] = [];
  const result = {
    saved,
    fallback: vi.fn(async () => FALLBACK),
    discardProposals: vi.fn(async () => {}),
    updateFatigue: vi.fn(
      async (fatigue: "high" | "medium"): Promise<DailyCheckin> => ({
        date: TODAY, mood: null, fatigue, concentration: null, want_task_ids: [], avoid_task_ids: [], note: null,
      }),
    ),
  };
  const value: ChatTurnDeps = {
    llmEnabled: () => true,
    fallback: result.fallback,
    saveProposals: async (proposals) => {
      saved.push(proposals);
    },
    discardProposals: result.discardProposals,
    updateFatigue: result.updateFatigue,
    newId: idFactory("id"),
    elapsedMs: () => 0,
    ...overrides,
  };
  return { ...result, value };
}

function run(fixture: ChatFixture, d: ChatTurnDeps, request: { text: string; open_proposal_ids?: string[] }) {
  return runReplanChatTurn(
    {
      request: { date: TODAY, text: request.text, history: [], open_proposal_ids: request.open_proposal_ids ?? [] },
      context: fixture.context,
      beforeDays: fixture.beforeDays,
      openOptions: (request.open_proposal_ids ?? []).map((_, i) => ({ index: i + 1, label: `案${i + 1}` })),
      storedRows: new Map(),
      userId: "user-1",
      weeklyPlanId: "plan-1",
    },
    d,
  );
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  mockedCall.mockReset();
  vi.restoreAllMocks();
});

describe("runReplanChatTurn（replan-chat.md 12.11）", () => {
  it("1回目が存在しない item_id の案 → feedback にその理由が入り、2回目の正しい案が返る", async () => {
    const fixture = chatFixture();
    const listening = findBefore(fixture, TODAY, (item) => item.task_id === "task_toeic_listening");
    const { planInputs } = setupLlm([
      llmReply({ reply_type: "proposal", options: [{ label: "明日に回す", ops: [op({ op: "postpone", item_id: "no-such-item" })] }] }),
      llmReply({ reply_type: "proposal", options: [{ label: "明日に回す", ops: [op({ op: "postpone", item_id: listening.id })] }] }),
    ]);
    const d = deps();
    const response = await run(fixture, d.value, { text: "リスニング明日に回して" });

    expect(planInputs).toHaveLength(2);
    expect(planInputs[0]).not.toHaveProperty("feedback");
    expect(planInputs[1].feedback).toEqual([
      { label: "明日に回す", errors: ["item_id「no-such-item」は今日のこれから変えられるタスクにありません"] },
    ]);
    expect(response.source).toBe("llm");
    expect(response.proposals).toHaveLength(1);
    expect(response.proposals[0].label).toBe("明日に回す");
    // 会話の経路の intent（12.9 の互換の形）
    expect(response.proposals[0].intent).toEqual({
      type: "preference_change", fatigue: null, task_changes: [], new_fixed_events: [], preference_changes: ["明日に回す"],
    });
    expect(response.proposals[0].summary_message).toContain("TOEIC リスニング演習を");
    // 通った案だけを保存する
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0].map((entry) => entry.proposal.proposal_id)).toEqual(response.proposals.map((p) => p.proposal_id));
    expect(d.fallback).not.toHaveBeenCalled();
  }, 30_000);

  it("select：open_proposal_ids の2番目を selected_proposal_id にする", async () => {
    setupLlm([llmReply({ reply_type: "select", select_index: 2 })]);
    const d = deps();
    const response = await run(chatFixture(), d.value, { text: "案2で", open_proposal_ids: ["p-1", "p-2"] });
    expect(response).toEqual({
      message: "案2にしますね。よければ『この計画にする』を押してください。",
      proposals: [],
      selected_proposal_id: "p-2",
      discarded: false,
      source: "llm",
    });
  });

  it("select：番号の案がないときは聞き返す", async () => {
    setupLlm([llmReply({ reply_type: "select", select_index: 3 })]);
    const response = await run(chatFixture(), deps().value, { text: "案3で", open_proposal_ids: ["p-1"] });
    expect(response.selected_proposal_id).toBeNull();
    expect(response.message).toBe("どの案にするか、番号で教えてください。");
  });

  it("discard：出ている案を discarded にし、discarded = true", async () => {
    setupLlm([llmReply({ reply_type: "discard" })]);
    const d = deps();
    const response = await run(chatFixture(), d.value, { text: "やっぱりナシで", open_proposal_ids: ["p-1", "p-2"] });
    expect(d.discardProposals).toHaveBeenCalledWith(["p-1", "p-2"]);
    expect(response).toEqual({
      message: "わかりました。今の予定のままにします。",
      proposals: [],
      selected_proposal_id: null,
      discarded: true,
      source: "llm",
    });
  });

  it("chat・question：text をそのまま返し、案は出さない", async () => {
    setupLlm([llmReply({ reply_type: "chat", text: "いいですね、その調子です！" })]);
    expect(await run(chatFixture(), deps().value, { text: "今日は頑張れそう" })).toEqual({
      message: "いいですね、その調子です！", proposals: [], selected_proposal_id: null, discarded: false, source: "llm",
    });
    setupLlm([llmReply({ reply_type: "question", text: "どれを減らしたいですか？（例：ES・TOEIC）" })]);
    const question = await run(chatFixture(), deps().value, { text: "なんか変えたい" });
    expect(question.message).toBe("どれを減らしたいですか？（例：ES・TOEIC）");
    expect(question.proposals).toEqual([]);
  });

  it("1回目の LlmError → 12.2 の経路（source: fallback）", async () => {
    setupLlm([new LlmError("timeout")]);
    const d = deps();
    const response = await run(chatFixture(), d.value, { text: "今日は疲れた" });
    expect(d.fallback).toHaveBeenCalledTimes(1);
    expect(response.source).toBe("fallback");
  });

  it("LLM_MODE=off → LLM を呼ばずに 12.2 の経路", async () => {
    setupLlm([]);
    const d = deps({ llmEnabled: () => false });
    const response = await run(chatFixture(), d.value, { text: "今日は疲れた" });
    expect(mockedCall).not.toHaveBeenCalled();
    expect(response.source).toBe("fallback");
  });

  it("2回目の LlmError → できる範囲を伝える文、proposals は空", async () => {
    setupLlm(
      [
        llmReply({ reply_type: "proposal", options: [{ label: "飲み会", ops: [op({ op: "add_event", title: "飲み会", start: "19:00", end: "21:00" })] }] }),
        new LlmError("timeout"),
      ],
      new LlmError("timeout"),
    );
    const d = deps();
    const response = await run(chatFixture(), d.value, { text: "19時から21時まで飲み会" });
    expect(d.fallback).not.toHaveBeenCalled();
    expect(response.proposals).toEqual([]);
    expect(response.source).toBe("llm");
    expect(response.message).toContain("夕食（19:00〜19:45）と重なるため入れられません");
    expect(d.saved).toEqual([]);
  });

  it("Engine・Validator の失敗だけで通らない → 決まった文を返し、理由はログにだけ出す", async () => {
    const fixture = chatFixture();
    // 目標の実施済みを実際と合わない値にして、tired_plan（replan()）の検証を失敗させる
    fixture.context.goal_done_minutes = { goal_toeic: 60 };
    const tired = () => llmReply({ reply_type: "proposal", fatigue: "high", options: [{ label: "今夜は軽めにする", ops: [op({ op: "tired_plan" })] }] });
    const { planInputs } = setupLlm([tired(), tired(), tired()]);
    const warn = vi.mocked(console.warn);

    const response = await run(fixture, deps().value, { text: "今日は疲れた" });
    expect(response).toEqual({
      message: "うまく組み直せませんでした。時間や内容を変えて教えてください。",
      proposals: [],
      selected_proposal_id: null,
      discarded: false,
      source: "llm",
    });
    // LLM には理由を返す（やり直しのため）。説明の呼び出しはしない
    expect(planInputs[1].feedback).toEqual([{ label: "今夜は軽めにする", errors: [expect.stringContaining("再計画後の検証に失敗しました")] }]);
    expect(mockedCall.mock.calls.map(([options]) => options.name)).toEqual(["replan_chat", "replan_chat", "replan_chat"]);
    // サーバーのログには理由だけ。発言は出さない
    const logged = warn.mock.calls.map((args) => args.join(" "));
    expect(logged).toContainEqual(expect.stringMatching(/^\[replan-chat\] engine failed: 再計画後の検証に失敗しました/));
    expect(logged.some((line) => line.includes("今日は疲れた"))).toBe(false);
  }, 30_000);

  it("やり直す前に15秒を超えそうなら打ち切る", async () => {
    const { planInputs } = setupLlm([
      llmReply({ reply_type: "proposal", options: [{ label: "x", ops: [op({ op: "postpone", item_id: "no-such-item" })] }] }),
    ]);
    // 経過 6 秒：6 + 8 + 1.5 > 15
    const response = await run(chatFixture(), deps({ elapsedMs: () => 6000 }).value, { text: "明日に回して" });
    expect(planInputs).toHaveLength(1);
    expect(response.proposals).toEqual([]);
  });

  it("tired_plan と add_rest の2案 → proposals が2件、label と warnings、fatigue を先に更新する", async () => {
    const fixture = chatFixture();
    setupLlm([
      llmReply({
        reply_type: "proposal",
        fatigue: "high",
        options: [
          { label: "今夜は軽めにする", ops: [op({ op: "tired_plan" })] },
          { label: "仮眠してから続ける", ops: [op({ op: "add_rest", title: "仮眠", start: "now", minutes: 20 })] },
        ],
      }),
    ]);
    const d = deps();
    const response = await run(fixture, d.value, { text: "めちゃくちゃ眠い" });

    expect(d.updateFatigue).toHaveBeenCalledWith("high");
    expect(response.source).toBe("llm");
    expect(response.proposals.map((p) => p.label)).toEqual(["今夜は軽めにする", "仮眠してから続ける"]);
    for (const proposal of response.proposals) expect(Array.isArray(proposal.warnings)).toBe(true);
    // tired_plan は Engine の intent のまま。add_rest は互換の形
    expect(response.proposals[0].intent.type).toBe("state_change");
    expect(response.proposals[1].intent).toEqual({
      type: "preference_change", fatigue: "high", task_changes: [], new_fixed_events: [], preference_changes: ["仮眠してから続ける"],
    });
    expect(response.proposals[1].summary_message).toContain("仮眠を入れる");
    expect(d.saved[0]).toHaveLength(2);
    expect(new Set(response.proposals.map((p) => p.proposal_id)).size).toBe(2);
  }, 30_000);

  it("toFallbackResponse：12.2 の提案に intent から label を付ける", () => {
    const fixture = chatFixture();
    const result = replan(fixture.context, fixture.beforeDays, {
      type: "state_change", fatigue: "high", task_changes: [], new_fixed_events: [], preference_changes: [],
    });
    if (!result.ok) throw new Error(result.infeasible.reason);
    const response = toFallbackResponse({ ...result.proposal, proposal_id: "p-1" });
    expect(response.source).toBe("fallback");
    expect(response.message).toBe(result.proposal.summary_message);
    expect(response.proposals).toEqual([expect.objectContaining({ proposal_id: "p-1", label: "今夜は軽めにする", warnings: [] })]);
  }, 30_000);
});

describe("予定・タスクを足す（replan-add.md 12.19〜12.21）", () => {
  const INSERT_VALUES = { weeklyPlanId: "plan-1", date: TODAY, userId: "user-1", now: "2026-10-05T18:00:00+09:00", version: 3, expiresAt: "2026-10-05T09:30:00.000Z" };

  it("add_task の案 → 保存する行の new_tasks に tasks の列の形で入る。facts・テンプレートに足したタスク", async () => {
    setupLlm(
      [llmReply({ reply_type: "proposal", options: [{ label: "レポートを入れる", ops: [op({ op: "add_task", title: "統計レポート", minutes: 120, deadline_date: "2026-10-09" })] }] })],
      new LlmError("timeout"),
    );
    const d = deps();
    const response = await run(chatFixture(), d.value, { text: "金曜までに統計のレポート2時間やらなきゃ" });
    expect(response.proposals).toHaveLength(1);
    const [entry] = d.saved[0];
    expect(entry.newTasks).toEqual([expect.objectContaining({ title: "統計レポート", goal_id: null, deadline_at: "2026-10-09T23:59:00+09:00", estimated_minutes: 120 })]);
    const row = buildProposalInsert(entry, INSERT_VALUES);
    expect(row.new_tasks).toEqual([{ ...entry.newTasks[0], user_id: "user-1", created_at: INSERT_VALUES.now }]);
    expect(Object.keys(row.new_tasks![0]).sort()).toEqual(
      ["id", "user_id", "title", "goal_id", "deadline_at", "estimated_minutes", "remaining_minutes", "importance", "concentration", "splittable", "interruptible", "buffer_fit", "status", "created_at"].sort(),
    );
    expect(row).toMatchObject({ id: entry.proposal.proposal_id, weekly_plan_id: "plan-1", date: TODAY, new_fixed_events: [], base_version: 3 });
    // 説明の呼び出しが失敗 → テンプレートに足したタスクの文が入る
    expect(response.message).toBe(
      "レポートを入れるの案を用意しました。統計レポート（120分・10/9まで）を10/6（火）60分、10/7（水）60分に入れます。",
    );
    expect(response.proposals[0].summary_message).toContain("火曜の17:00〜18:00 に統計レポートを入れる");
  }, 30_000);

  it("add_event weekly の案 → new_fixed_events の行の recurrence が weekly。タスクを足さない案は new_tasks を送らない", async () => {
    setupLlm([
      llmReply({
        reply_type: "proposal",
        options: [{ label: "毎週ジム", ops: [op({ op: "add_event", title: "ジム", repeat: "weekly", weekday: "水", start: "18:00", end: "19:00" })] }],
      }),
    ]);
    const d = deps();
    const response = await run(chatFixture(), d.value, { text: "毎週水曜の18時からジムに行くことにした" });
    expect(response.proposals).toHaveLength(1);
    const row = buildProposalInsert(d.saved[0][0], INSERT_VALUES);
    expect(row.new_fixed_events).toEqual([
      expect.objectContaining({ title: "ジム", recurrence: "weekly", start_at: "2026-10-07T18:00:00+09:00", user_id: "user-1" }),
    ]);
    expect(row).not.toHaveProperty("new_tasks");
    expect(response.proposals[0].intent.new_fixed_events).toEqual([expect.objectContaining({ recurrence: "weekly" })]);
  }, 30_000);

  it("締切か時間がない発言で LLM が question を返す → その text で返り、案は出さない", async () => {
    const text = "いつまでに終わらせたいですか？（例：金曜の夜まで、10/9まで）";
    setupLlm([llmReply({ reply_type: "question", text })]);
    const d = deps();
    const response = await run(chatFixture(), d.value, { text: "レポートやらなきゃ" });
    expect(response).toEqual({ message: text, proposals: [], selected_proposal_id: null, discarded: false, source: "llm" });
    expect(d.saved).toEqual([]);
  });

  it("buildReplanChatInput：week は月曜〜日曜の7日分。今日より前は past: true、events に食事・睡眠・移動は入らない", () => {
    const fixture = chatFixture("2026-10-07T18:00:00+09:00");
    const input = buildReplanChatInput({ context: fixture.context, beforeDays: fixture.beforeDays, text: "x", history: [], openOptions: [], feedback: [] });
    expect(input.week.map((day) => [day.date, day.weekday, "past" in day])).toEqual([
      ["2026-10-05", "月", true],
      ["2026-10-06", "火", true],
      ["2026-10-07", "水", false],
      ["2026-10-08", "木", false],
      ["2026-10-09", "金", false],
      ["2026-10-10", "土", false],
      ["2026-10-11", "日", false],
    ]);
    expect(input.week[0]).toEqual({ date: "2026-10-05", weekday: "月", past: true, events: ["1限 マクロ経済学 9:00〜10:30", "2限 統計学 10:40〜12:10"] });
    expect(input.week[1].events).toEqual(["3限 英語コミュニケーション 13:00〜14:30", "4限 経営学 14:40〜16:10", "バイト（休憩・まかない含む） 18:00〜22:00"]);
    // 食事（fixed_category "meal"）・睡眠・移動は入らない。友人・家族との食事（social・family）は予定として入る
    const events = input.week.flatMap((day) => day.events);
    expect(events.filter((event) => /^(朝食|昼食|夕食|睡眠|移動) /.test(event))).toEqual([]);
    expect(events).toEqual(expect.arrayContaining(["友人と夕食 19:00〜21:00", "家族と昼食 12:00〜13:30"]));
  });
});
