import { describe, expect, it } from "vitest";
import { extractReplanIntentByKeywords, type ReplanTaskOption } from "@/lib/llm/replan-keywords";
import { PROVISIONAL_END_NOTE, toReplanningIntent } from "@/lib/server/replan-intent";

// 10/5（月）18:00。今日の now 以降のタスク項目
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
  {
    task_id: "t-listening",
    title: "TOEIC リスニング演習",
    start_at: "2026-10-05T21:15:00+09:00",
    end_at: "2026-10-05T21:45:00+09:00",
  },
];

function run(text: string, now = NOW) {
  return toReplanningIntent(extractReplanIntentByKeywords(text, TASKS), {
    date: DATE,
    now,
    todayTasks: TASKS,
  });
}

function ok(text: string, now = NOW) {
  const result = run(text, now);
  if (result.type !== "ok") throw new Error(`unknown になった: ${text}`);
  return result;
}

describe("再計画の意図（キーワード。plans-replan.md 12.3.2・12.3.1）", () => {
  it("「今日は疲れた」→ state_change・fatigue high", () => {
    const { intent } = ok("今日は疲れた");
    expect(intent.type).toBe("state_change");
    expect(intent.fatigue).toBe("high");
  });

  it.each(["つかれたー", "しんどい", "だるい", "眠い", "ねむい"])(
    "「%s」も state_change",
    (text) => {
      expect(ok(text).intent.type).toBe("state_change");
    },
  );

  it("「20時から1時間予定が入った」→ new_fixed_event 20:00〜21:00", () => {
    const { intent, provisional_end } = ok("20時から1時間予定が入った");
    expect(intent.type).toBe("new_fixed_event");
    expect(intent.new_fixed_events).toHaveLength(1);
    const [event] = intent.new_fixed_events;
    expect(event).toMatchObject({
      title: "予定",
      category: "other",
      location_id: null,
      recurrence: null,
      start_at: "2026-10-05T20:00:00+09:00",
      end_at: "2026-10-05T21:00:00+09:00",
    });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(provisional_end).toBe(false);
  });

  it("「20時から予定」→ 20:00〜21:00（仮置き）", () => {
    const { intent, provisional_end } = ok("20時から予定");
    expect(intent.new_fixed_events[0]).toMatchObject({
      start_at: "2026-10-05T20:00:00+09:00",
      end_at: "2026-10-05T21:00:00+09:00",
    });
    expect(provisional_end).toBe(true);
    expect(PROVISIONAL_END_NOTE).toBe("終わりの時刻が分からないため、1時間で仮置きしました。");
  });

  it("「20時半から22時までバイト」→ 20:30〜22:00", () => {
    const { intent, provisional_end } = ok("20時半から22時までバイト");
    expect(intent.new_fixed_events[0]).toMatchObject({
      start_at: "2026-10-05T20:30:00+09:00",
      end_at: "2026-10-05T22:00:00+09:00",
    });
    expect(provisional_end).toBe(false);
  });

  it("全角の数字「２０時から１時間会議」も読む", () => {
    expect(ok("２０時から１時間会議").intent.new_fixed_events[0]).toMatchObject({
      start_at: "2026-10-05T20:00:00+09:00",
      end_at: "2026-10-05T21:00:00+09:00",
    });
  });

  it("「〇時から」があっても予定の言葉がなければ new_fixed_event にしない", () => {
    expect(run("20時から散歩したい").type).toBe("unknown");
  });

  it("開始が now より前の予定は捨て、unknown になる", () => {
    expect(run("17時から1時間予定が入った").type).toBe("unknown");
  });

  it("終了が 24:00 を超える予定は捨て、unknown になる", () => {
    expect(run("23時半から予定").type).toBe("unknown");
    expect(run("23時から2時間予定").type).toBe("unknown");
  });

  it("「今日はもう勉強したくない」→ 今日の now 以降のタスクすべて postpone（同じタスクは1回）", () => {
    const { intent } = ok("今日はもう勉強したくない");
    expect(intent.type).toBe("task_change");
    expect(intent.task_changes).toEqual([
      { task_id: "t-listening", action: "postpone" },
      { task_id: "t-es", action: "postpone" },
    ]);
  });

  it("「もう無理」も同じ", () => {
    expect(ok("もう無理").intent.task_changes).toHaveLength(2);
  });

  it("今日の now 以降にタスクがなければ「勉強したくない」は unknown", () => {
    const result = toReplanningIntent(extractReplanIntentByKeywords("勉強したくない", []), {
      date: DATE,
      now: NOW,
      todayTasks: [],
    });
    expect(result.type).toBe("unknown");
  });

  it("「ES作成は明日に回したい」→ そのタスクだけ postpone", () => {
    expect(ok("ES作成は明日に回したい").intent.task_changes).toEqual([
      { task_id: "t-es", action: "postpone" },
    ]);
  });

  it("「明日に回」でもタスク名がなければ unknown", () => {
    expect(run("明日にまわしたい").type).toBe("unknown");
  });

  it("「今日はいい天気」→ unknown", () => {
    expect(run("今日はいい天気").type).toBe("unknown");
  });

  it("上から順に調べる：疲れ と 予定 の両方があれば state_change", () => {
    expect(ok("疲れたし20時から予定がある").intent.type).toBe("state_change");
  });
});

describe("意図の変換・検証（12.3.1。LLM の出力を想定）", () => {
  const base = { fatigue: null, task_changes: [], new_fixed_events: [], preference_changes: [] };

  it("入力にない task_id は捨て、残らなければ unknown", () => {
    const input = { date: DATE, now: NOW, todayTasks: TASKS };
    expect(
      toReplanningIntent(
        { ...base, type: "task_change", task_changes: [{ task_id: "nope", action: "skip" }] },
        input,
      ).type,
    ).toBe("unknown");
    const result = toReplanningIntent(
      {
        ...base,
        type: "task_change",
        task_changes: [
          { task_id: "nope", action: "skip" },
          { task_id: "t-es", action: "shorten" },
        ],
      },
      input,
    );
    expect(result.type === "ok" && result.intent.task_changes).toEqual([
      { task_id: "t-es", action: "shorten" },
    ]);
  });

  it("title はそのまま使い、開始 ≥ 終了・形の違う時刻は捨てる", () => {
    const result = toReplanningIntent(
      {
        ...base,
        type: "new_fixed_event",
        new_fixed_events: [
          { title: "歯医者", start_time: "19:00", end_time: "20:00" },
          { title: "逆", start_time: "21:00", end_time: "20:00" },
          { title: "形", start_time: "9時", end_time: null },
        ],
      },
      { date: DATE, now: NOW, todayTasks: TASKS },
    );
    expect(result.type).toBe("ok");
    if (result.type !== "ok") return;
    expect(result.intent.new_fixed_events.map((e) => e.title)).toEqual(["歯医者"]);
  });

  it("24:00 ちょうどに終わる予定は入れられる", () => {
    const result = toReplanningIntent(
      {
        ...base,
        type: "new_fixed_event",
        new_fixed_events: [{ title: null, start_time: "23:00", end_time: "24:00" }],
      },
      { date: DATE, now: NOW, todayTasks: TASKS },
    );
    expect(result.type === "ok" && result.intent.new_fixed_events[0].end_at).toBe(
      "2026-10-06T00:00:00+09:00",
    );
  });

  it("preference_change はそのまま通す（対応しない返事は API が出す）", () => {
    const result = toReplanningIntent(
      { ...base, type: "preference_change", preference_changes: ["朝型にしたい"] },
      { date: DATE, now: NOW, todayTasks: TASKS },
    );
    expect(result.type === "ok" && result.intent.type).toBe("preference_change");
  });
});
