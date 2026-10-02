import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callStructured, LlmError } from "@/lib/llm/client";
import {
  buildOptionFacts,
  extractNumberTokens,
  templateMessage,
  writeReplanChatMessage,
  type OptionFacts,
} from "@/lib/llm/replan-chat-message";

// 会話の再計画の説明と数字の検査（replan-chat.md 12.12）。callStructured だけを差し替える

vi.mock("@/lib/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/client")>();
  return { ...actual, callStructured: vi.fn() };
});

const mockedCall = vi.mocked(callStructured);

const FACTS: OptionFacts = {
  label: "飲み会を入れる",
  summary: ["20:00〜22:00 に飲み会を入れる", "TOEIC リスニング演習を水曜に回す"],
  today_task_minutes_delta: -60,
  today_free_minutes_delta: -35,
  other_days: ["水曜：TOEIC リスニング演習 +60分"],
  deadline: "none",
  warnings: [],
  added_events: [],
  added_tasks: [],
  dropped: [],
};

const TEMPLATE = templateMessage([FACTS], []);

function llmSays(message: string) {
  mockedCall.mockResolvedValue({ message });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  mockedCall.mockReset();
  vi.restoreAllMocks();
});

describe("writeReplanChatMessage（replan-chat.md 12.12）", () => {
  it("facts にない「45分」を含む文 → テンプレート", async () => {
    llmSays("了解です。飲み会を入れて、自由時間が45分減ります。");
    expect(await writeReplanChatMessage({ userText: "20時から飲み会", options: [FACTS], failed: [] })).toBe(TEMPLATE);
  });

  it("facts にある数字だけなら LLM の文のまま", async () => {
    const message = "楽しんできてください！20:00〜22:00 に飲み会を入れ、リスニングは水曜に60分回します。自由時間は35分減ります。";
    llmSays(message);
    expect(await writeReplanChatMessage({ userText: "飲み会に誘われた", options: [FACTS], failed: [] })).toBe(message);
  });

  it("facts が 20:00、文が「20時」→ 同じ時刻とみなし、LLM の文のまま", async () => {
    const message = "20時からの飲み会、楽しんでください。リスニングは水曜に回します。";
    llmSays(message);
    expect(await writeReplanChatMessage({ userText: "飲み会に誘われた", options: [FACTS], failed: [] })).toBe(message);
  });

  it("利用者の発言にある時刻（「20時から」）は使ってよい", async () => {
    const facts = { ...FACTS, summary: ["飲み会を入れる"] };
    const message = "20時から飲み会ですね。予定に入れました。";
    llmSays(message);
    expect(await writeReplanChatMessage({ userText: "20時から飲み会", options: [facts], failed: [] })).toBe(message);
    // 発言にも facts にもない時刻はテンプレート
    llmSays("21時から飲み会ですね。");
    expect(await writeReplanChatMessage({ userText: "20時から飲み会", options: [facts], failed: [] })).toBe(
      templateMessage([facts], []),
    );
  });

  it("「2時間」を「2時」と取り違えない", async () => {
    // facts に 2:00 はなく、2時間もない
    llmSays("飲み会は2時間ですね。");
    expect(await writeReplanChatMessage({ userText: "飲み会", options: [FACTS], failed: [] })).toBe(TEMPLATE);
    expect(extractNumberTokens("2時間半と20時と20時半と20時15分と10/9と30分")).toEqual([
      "h:2.5", "t:1200", "t:1230", "t:1215", "d:10/9", "m:30",
    ]);
  });

  it("LLM が失敗 → テンプレート", async () => {
    mockedCall.mockRejectedValue(new LlmError("timeout"));
    expect(await writeReplanChatMessage({ userText: "飲み会", options: [FACTS], failed: [] })).toBe(TEMPLATE);
  });

  it("残り時間が短ければ LLM を呼ばずにテンプレート", async () => {
    expect(await writeReplanChatMessage({ userText: "飲み会", options: [FACTS], failed: [], timeoutMs: 1000 })).toBe(TEMPLATE);
    expect(mockedCall).not.toHaveBeenCalled();
  });
});

describe("templateMessage", () => {
  it("案が1つ・複数・なし", () => {
    expect(templateMessage([{ ...FACTS, warnings: ["今週のTOEIC学習が40分足りなくなります"] }], [])).toBe(
      "飲み会を入れるの案を用意しました。今週のTOEIC学習が40分足りなくなります。",
    );
    expect(templateMessage([FACTS, { ...FACTS, label: "仮眠してから続ける" }], [])).toBe(
      "案を2つ用意しました。案1：飲み会を入れる、案2：仮眠してから続ける。",
    );
    expect(templateMessage([], ["夕食（19:00〜19:45）と重なるため入れられません"])).toContain("（夕食（19:00〜19:45）と重なるため入れられません）");
  });
});

describe("足した予定・タスクの facts（replan-add.md 12.21）", () => {
  const ADDED: OptionFacts = {
    ...FACTS,
    label: "予定とレポートを入れる",
    summary: ["水曜の18:00〜19:00 にジムを入れる"],
    other_days: [],
    added_events: ["毎週水曜 18:00〜19:00 ジム（今週は10/7から）"],
    added_tasks: [{ title: "統計レポート", total_minutes: 120, deadline: "10/9", placed: ["10/6（火）60分", "10/7（水）60分"] }],
  };

  it("added_tasks の「120分」「2時間」「10/9」、added_events の「10/7」は facts として通る", async () => {
    const message = "統計レポートは合計120分（2時間）、10/9までに終わるよう火曜と水曜に60分ずつ入れました。ジムは10/7から毎週です。";
    llmSays(message);
    expect(await writeReplanChatMessage({ userText: "毎週ジム、レポートも", options: [ADDED], failed: [] })).toBe(message);
  });

  it("facts にない数字（「90分」「10/8」）はテンプレートになる", async () => {
    const template = templateMessage([ADDED], []);
    llmSays("統計レポートを90分ずつ入れました。");
    expect(await writeReplanChatMessage({ userText: "レポート", options: [ADDED], failed: [] })).toBe(template);
    llmSays("ジムは10/8からです。");
    expect(await writeReplanChatMessage({ userText: "ジム", options: [ADDED], failed: [] })).toBe(template);
  });

  it("テンプレートに足した予定・タスクの文が入る（案が複数なら「案{n}：」を付ける）", () => {
    expect(templateMessage([ADDED], [])).toBe(
      "予定とレポートを入れるの案を用意しました。毎週水曜 18:00〜19:00 ジム（今週は10/7から）を入れます。統計レポート（120分・10/9まで）を10/6（火）60分、10/7（水）60分に入れます。",
    );
    const unplaced = { ...ADDED, added_events: [], added_tasks: [{ ...ADDED.added_tasks[0], placed: [] }] };
    expect(templateMessage([FACTS, unplaced], [])).toBe(
      "案を2つ用意しました。案1：飲み会を入れる、案2：予定とレポートを入れる。案2：統計レポート（120分・10/9まで）を足します。",
    );
  });

  it("buildOptionFacts：1回きりは「10/8（木）15:00〜16:00 面接」、毎週は今週から・来週からを付ける", () => {
    const event = (id: string, start: string, end: string, recurrence: "weekly" | null) => ({
      id, title: id, category: "other" as const, location_id: null, start_at: start, end_at: end, recurrence,
    });
    const facts = buildOptionFacts({
      label: "予定を入れる",
      proposal: {
        date: "2026-10-05",
        intent: { type: "preference_change", fatigue: null, task_changes: [], new_fixed_events: [], preference_changes: [] },
        before: { date: "2026-10-05", items: [] },
        after: { date: "2026-10-05", items: [] },
        changes: [],
        other_day_changes: [],
        summary_message: "",
      },
      warnings: [],
      tasks: [],
      newFixedEvents: [
        event("面接", "2026-10-08T15:00:00+09:00", "2026-10-08T16:00:00+09:00", null),
        event("ジム", "2026-10-07T18:00:00+09:00", "2026-10-07T19:00:00+09:00", "weekly"),
        event("自習", "2026-10-12T09:00:00+09:00", "2026-10-12T10:00:00+09:00", "weekly"),
      ],
      newTasks: [],
    });
    expect(facts.added_events).toEqual([
      "10/8（木）15:00〜16:00 面接",
      "毎週水曜 18:00〜19:00 ジム（今週は10/7から）",
      "毎週月曜 9:00〜10:00 自習（来週の10/12から）",
    ]);
    // 来週から始まる毎週の予定は、今週の変更点にないので要約に足す
    expect(facts.summary).toEqual(["毎週月曜 9:00〜10:00 自習（来週の10/12から）を入れる"]);
  });
});
