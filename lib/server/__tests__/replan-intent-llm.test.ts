import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplanTaskOption } from "@/lib/llm/replan-keywords";
import { extractReplanIntent } from "@/lib/server/replan-intent";

// extractReplanIntent：LLM が有効なら LLM、失敗したらキーワード（plans-replan.md 12.3）。
// fetch と環境変数はテストの中だけで差し替える（実際の OpenAI は呼ばない）

const DATE = "2026-10-05";
const NOW = "2026-10-05T18:00:00+09:00";
const TASKS: ReplanTaskOption[] = [
  {
    task_id: "t-listening",
    title: "TOEIC リスニング演習",
    start_at: "2026-10-05T18:00:00+09:00",
    end_at: "2026-10-05T19:00:00+09:00",
  },
  {
    task_id: "t-es",
    title: "ES作成",
    start_at: "2026-10-05T20:00:00+09:00",
    end_at: "2026-10-05T21:00:00+09:00",
  },
];
const INPUT = { date: DATE, now: NOW, todayTasks: TASKS };

const EMPTY = { fatigue: null, task_changes: [], new_fixed_events: [], preference_changes: [] };

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

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractReplanIntent", () => {
  it("LLM 無効 → fetch を呼ばず、キーワードの結果", async () => {
    vi.stubEnv("LLM_MODE", "off");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractReplanIntent("今日は疲れた", INPUT);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.type).toBe("ok");
    if (result.type === "ok") {
      expect(result.intent.type).toBe("state_change");
      expect(result.intent.fatigue).toBe("high");
    }
  });

  it("LlmError（HTTP 500）→ キーワードの結果", async () => {
    enableLlm();
    const fetchMock = vi.fn().mockResolvedValue(new Response("error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractReplanIntent("20時から1時間予定が入った", INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(1); // retries: 0
    expect(result.type).toBe("ok");
    if (result.type === "ok") {
      expect(result.intent.type).toBe("new_fixed_event");
      expect(result.intent.new_fixed_events[0].start_at).toBe("2026-10-05T20:00:00+09:00");
      expect(result.intent.new_fixed_events[0].end_at).toBe("2026-10-05T21:00:00+09:00");
    }
  });

  it("LLM 成功 → LLM の結果（キーワードでは unknown になる発言）", async () => {
    enableLlm();
    const fetchMock = vi.fn().mockResolvedValue(
      completion({
        ...EMPTY,
        type: "task_change",
        task_changes: [{ task_id: "t-es", action: "postpone" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractReplanIntent("ESは後日やることにする", INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.type).toBe("ok");
    if (result.type === "ok") {
      expect(result.intent.type).toBe("task_change");
      expect(result.intent.task_changes).toEqual([{ task_id: "t-es", action: "postpone" }]);
    }

    // 渡したタスクの時刻は "HH:MM"
    const user = JSON.parse(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content);
    expect(user.today_tasks[1]).toEqual({
      task_id: "t-es",
      title: "ES作成",
      start_time: "20:00",
      end_time: "21:00",
    });
  });

  it("LLM が unknown を返す → キーワードに戻さず unknown", async () => {
    enableLlm();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion({ ...EMPTY, type: "unknown" })));

    // キーワードなら state_change になる発言
    await expect(extractReplanIntent("今日は疲れた", INPUT)).resolves.toEqual({ type: "unknown" });
  });

  it("LLM が一覧にない task_id を返す → 例外にならず（500 にならず）unknown", async () => {
    enableLlm();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        completion({
          ...EMPTY,
          type: "task_change",
          task_changes: [{ task_id: "t-not-in-list", action: "postpone" }],
        }),
      ),
    );

    await expect(extractReplanIntent("それは明日にしたい", INPUT)).resolves.toEqual({ type: "unknown" });
  });

  it("LLM の結果の変換で例外が出る → キーワードの結果", async () => {
    enableLlm();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        completion({
          ...EMPTY,
          type: "new_fixed_event",
          new_fixed_events: [{ title: "会議", start_time: "22:00", end_time: "23:00" }],
        }),
      ),
    );
    // LLM の結果の変換（予定の id 作り）でだけ例外を出す
    vi.spyOn(crypto, "randomUUID").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const result = await extractReplanIntent("20時から1時間予定が入った", INPUT);
    expect(result.type).toBe("ok");
    if (result.type === "ok") {
      // キーワードの結果（20:00〜21:00）。LLM の 22:00 ではない
      expect(result.intent.new_fixed_events[0].start_at).toBe("2026-10-05T20:00:00+09:00");
    }
  });

  it("LLM が形の違う時刻を返す → その予定を捨てて unknown（例外にならない）", async () => {
    enableLlm();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        completion({
          ...EMPTY,
          type: "new_fixed_event",
          new_fixed_events: [{ title: "会議", start_time: "夜8時", end_time: null }],
        }),
      ),
    );

    await expect(extractReplanIntent("夜に会議が入った", INPUT)).resolves.toEqual({ type: "unknown" });
  });
});
