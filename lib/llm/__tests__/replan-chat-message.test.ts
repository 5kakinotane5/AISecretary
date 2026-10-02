import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callStructured, LlmError } from "@/lib/llm/client";
import {
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
