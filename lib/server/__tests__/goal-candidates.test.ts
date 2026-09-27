import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FixedEvent } from "@/lib/schemas";
import {
  buildGoalCandidates,
  mergeCandidateTexts,
  summarizeFixedEvents,
  templateCandidateTexts,
} from "@/lib/server/goal-candidates";
import { EMPTY_SLOTS, type InterviewSlots } from "@/lib/server/repositories/interview";

// 目標時間3案（backend.md 7.2）：時間はルール、文章は LLM（失敗時・無効時はテンプレート。7.2.3）。
// fetch と環境変数はテストの中だけで差し替える（実際の OpenAI は呼ばない）

const TODAY = "2026-10-05";
const SLOTS: InterviewSlots = {
  ...EMPTY_SLOTS,
  category: "資格・テスト勉強",
  task_name: "TOEIC学習",
  current_status: "今は500点くらい",
  deadline: "2026-12-13", // 10週
  conditions: ["平日は夜が中心"],
  weekday_time_band: "evening",
};
const ARGS = { slots: SLOTS, today: TODAY, weeklyFreeMinutes: 2400, fixedEvents: [] };
const HOURS = { intensive: 9, balanced: 6, paced: 3 };

const LLM_TEXTS = [
  { characteristics: "週9時間で毎日しっかり取り組みます", merit: "早く力が伸びやすいです", caution: "疲れがたまりやすいです", reason: "短期間で伸ばしたい方向けです" },
  { characteristics: "平日の夜に無理なく続けます", merit: "予定と両立しやすいです", caution: "苦手分野は意識して取り組みましょう", reason: "標準的に進めたい方向けです" },
  { characteristics: "空いた時間に少しずつ進めます", merit: "負担が小さいです", caution: "伸びはゆっくりになりやすいです", reason: "忙しい時期でも続けたい方向けです" },
];

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

function mockLlm(candidates: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue(completion({ candidates }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const textsOf = (c: { characteristics: string; merit: string; caution: string; reason: string }) => ({
  characteristics: c.characteristics,
  merit: c.merit,
  caution: c.caution,
  reason: c.reason,
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

describe("buildGoalCandidates", () => {
  it("LLM 無効 → fetch を呼ばず、テンプレート・9 / 6 / 3", async () => {
    vi.stubEnv("LLM_MODE", "off");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await buildGoalCandidates(ARGS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.map((c) => c.style)).toEqual(["intensive", "balanced", "paced"]);
    expect(result.map((c) => c.hours_per_week)).toEqual([9, 6, 3]);
    expect(result.map((c) => c.label)).toEqual(["短期集中型", "バランス標準型", "マイペース型"]);
    expect(result.map((c) => c.expected_load)).toEqual(["high", "medium", "low"]);
    expect(result.every((c) => c.period_weeks === 10)).toBe(true);
    for (const c of result) expect(textsOf(c)).toEqual(templateCandidateTexts(c.style, "TOEIC学習"));
    expect(result[0].reason).toBe("TOEIC学習を短期間で進めたい場合の目安です");
  });

  it("task_name が null → テンプレートの名前はカテゴリ名", async () => {
    vi.stubEnv("LLM_MODE", "off");
    const result = await buildGoalCandidates({ ...ARGS, slots: { ...SLOTS, task_name: null } });
    expect(result[1].reason).toBe("資格・テスト勉強を標準的なペースで進める目安です");
  });

  it("weeklyFreeMinutes が null → 上限をかけない", async () => {
    vi.stubEnv("LLM_MODE", "off");
    const result = await buildGoalCandidates({ ...ARGS, weeklyFreeMinutes: null });
    expect(result.map((c) => c.hours_per_week)).toEqual([9, 6, 3]);
  });

  it("筋トレ・運動 → メインの 45分で回数から base を出す（7.3 の6行目）", async () => {
    vi.stubEnv("LLM_MODE", "off");
    const slots: InterviewSlots = { ...EMPTY_SLOTS, category: "筋トレ・運動", task_name: "筋トレ", frequency_per_week: 3 };
    const result = await buildGoalCandidates({ ...ARGS, slots });
    expect(result.map((c) => c.hours_per_week)).toEqual([3.5, 2.5, 1]);
  });

  it("LLM 成功 → LLM の文章（数値はルールのまま）", async () => {
    enableLlm();
    const fetchMock = mockLlm(LLM_TEXTS);

    const result = await buildGoalCandidates(ARGS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.map(textsOf)).toEqual(LLM_TEXTS);
    expect(result.map((c) => c.hours_per_week)).toEqual([9, 6, 3]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.response_format.json_schema.name).toBe("goal_candidate_texts");
    const input = JSON.parse(body.messages[1].content);
    expect(input.hours).toEqual(HOURS);
    expect(input.task_name).toBe("TOEIC学習");
  });

  it("intensive に「週8時間」→ intensive だけテンプレート", async () => {
    enableLlm();
    mockLlm([{ ...LLM_TEXTS[0], characteristics: "週8時間で毎日しっかり取り組みます" }, LLM_TEXTS[1], LLM_TEXTS[2]]);

    const result = await buildGoalCandidates(ARGS);
    expect(textsOf(result[0])).toEqual(templateCandidateTexts("intensive", "TOEIC学習"));
    expect(textsOf(result[1])).toEqual(LLM_TEXTS[1]);
    expect(textsOf(result[2])).toEqual(LLM_TEXTS[2]);
  });

  it("61文字の文 → その案だけテンプレート", async () => {
    enableLlm();
    mockLlm([LLM_TEXTS[0], { ...LLM_TEXTS[1], merit: "あ".repeat(61) }, LLM_TEXTS[2]]);

    const result = await buildGoalCandidates(ARGS);
    expect(textsOf(result[0])).toEqual(LLM_TEXTS[0]);
    expect(textsOf(result[1])).toEqual(templateCandidateTexts("balanced", "TOEIC学習"));
    expect(textsOf(result[2])).toEqual(LLM_TEXTS[2]);
  });

  it("2件 → 全部テンプレート", async () => {
    enableLlm();
    mockLlm(LLM_TEXTS.slice(0, 2));

    const result = await buildGoalCandidates(ARGS);
    for (const c of result) expect(textsOf(c)).toEqual(templateCandidateTexts(c.style, "TOEIC学習"));
  });

  it("LlmError（HTTP 500）→ 全部テンプレート", async () => {
    enableLlm();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));

    const result = await buildGoalCandidates(ARGS);
    expect(result.map((c) => c.hours_per_week)).toEqual([9, 6, 3]);
    for (const c of result) expect(textsOf(c)).toEqual(templateCandidateTexts(c.style, "TOEIC学習"));
  });
});

describe("mergeCandidateTexts", () => {
  it("全角数字・小数も数値として比べる（「９時間」「9.0時間」は 9 と同じ）", () => {
    const result = mergeCandidateTexts(
      HOURS,
      [
        { ...LLM_TEXTS[0], characteristics: "週９時間で進めます", merit: "9.0時間なら届きやすいです" },
        { ...LLM_TEXTS[1], characteristics: "週６．５時間で進めます" }, // 6.5 ≠ 6
        { ...LLM_TEXTS[2], characteristics: "週3hで進めます" },
      ],
      "TOEIC学習",
    );
    expect(result.intensive.characteristics).toBe("週９時間で進めます");
    expect(result.balanced).toEqual(templateCandidateTexts("balanced", "TOEIC学習"));
    expect(result.paced.characteristics).toBe("週3hで進めます");
  });

  it("1日あたりの時間（「1日1時間」）も案の時間と違えばテンプレート", () => {
    const result = mergeCandidateTexts(
      HOURS,
      [{ ...LLM_TEXTS[0], characteristics: "1日1時間ずつ進めます" }, LLM_TEXTS[1], LLM_TEXTS[2]],
      "TOEIC学習",
    );
    expect(result.intensive).toEqual(templateCandidateTexts("intensive", "TOEIC学習"));
  });

  it("空の文 → その案だけテンプレート", () => {
    const result = mergeCandidateTexts(HOURS, [LLM_TEXTS[0], LLM_TEXTS[1], { ...LLM_TEXTS[2], reason: "  " }], "TOEIC学習");
    expect(result.intensive).toEqual(LLM_TEXTS[0]);
    expect(result.paced).toEqual(templateCandidateTexts("paced", "TOEIC学習"));
  });
});

describe("summarizeFixedEvents", () => {
  const event = (id: string, category: FixedEvent["category"], date: string): FixedEvent => ({
    id,
    title: id,
    category,
    location_id: null,
    start_at: `${date}T10:00:00+09:00`,
    end_at: `${date}T12:00:00+09:00`,
    recurrence: "weekly",
  });

  it("バイト・授業を曜日（月〜日の順）でまとめる。ほかのカテゴリは使わない", () => {
    const events = [
      event("work-sat", "work", "2026-10-10"),
      event("work-tue", "work", "2026-10-06"),
      ...["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((d) => event(`class-${d}`, "class", d)),
      event("class-mon-2", "class", "2026-10-05"), // 同じ曜日は1回だけ
      event("meal", "meal", "2026-10-11"),
    ];
    expect(summarizeFixedEvents(events)).toBe("火・土はバイト、月・火・水・木・金は授業");
  });

  it("バイト・授業がなければ空文字", () => {
    expect(summarizeFixedEvents([])).toBe("");
    expect(summarizeFixedEvents([event("meal", "meal", "2026-10-05")])).toBe("");
  });
});
