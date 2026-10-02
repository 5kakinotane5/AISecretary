import { beforeAll, describe, expect, it } from "vitest";
import { diffMinutesExact } from "@/lib/datetime";
import { replan } from "@/lib/planning/replan";
import type { ReplanOpLlm } from "@/lib/schemas";
import { buildReplanRows } from "@/lib/server/replan-rows";
import { PROVISIONAL_END_NOTE } from "@/lib/server/replan-intent";
import { checkOption, MAX_OPS_PER_OPTION } from "../check";
import { at, blockFreeTime, chatFixture, findBefore, idFactory, op, TODAY, type ChatFixture } from "./helpers";

const TUESDAY = "2026-10-06";

function check(ops: ReplanOpLlm[], fixture: ChatFixture = chatFixture(), fatigue: "high" | "medium" | null = null) {
  return checkOption({ context: fixture.context, beforeDays: fixture.beforeDays, option: { label: "テストの案", ops }, fatigue, newId: idFactory() });
}

const taskMinutes = (days: { items: { kind: string; task_id: string | null; start_at: string; end_at: string }[] }[], taskId: string) =>
  days.flatMap((day) => day.items).filter((item) => item.kind === "task" && item.task_id === taskId).reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0);

// 3案の生成（chatFixture の初回）は重いので、各テストの時間に数えないよう先に1回だけ行う
beforeAll(() => {
  chatFixture();
}, 60_000);

describe("checkOption（replan-chat.md 12.11）", () => {
  it("skip（目標タスク）：errors 0、warnings に外した分の不足", () => {
    const fixture = chatFixture();
    const listening = findBefore(fixture, TODAY, (item) => item.task_id === "task_toeic_listening");
    const result = check([op({ op: "skip", item_id: listening.id })], fixture);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const skipped = diffMinutesExact(listening.start_at, listening.end_at);
    expect(result.warnings).toEqual([`今週のTOEIC学習が${skipped}分足りなくなります`]);
    expect(result.result.proposal.changes).toContainEqual(expect.objectContaining({ change_type: "removed", reason: "TOEIC リスニング演習は今週はお休みにしました" }));
    // 会話の経路の intent（12.9）
    expect(result.result.proposal.intent).toEqual({ type: "preference_change", fatigue: null, task_changes: [], new_fixed_events: [], preference_changes: ["テストの案"] });
  });

  it("shorten（目標タスク）：短くした分が warnings に出る", () => {
    const fixture = chatFixture();
    const listening = findBefore(fixture, TODAY, (item) => item.task_id === "task_toeic_listening");
    const result = check([op({ op: "shorten", item_id: listening.id, minutes: 30 })], fixture);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.warnings).toEqual(["今週のTOEIC学習が30分足りなくなります"]);
  });

  it("明日以降のタスクを（1案の上限の7個まで）全部 pull_forward：errors 0、溢れた分は元の日か別の日に戻る", () => {
    const fixture = chatFixture();
    const later = fixture.beforeDays
      .filter((day) => day.date > TODAY)
      .flatMap((day) => day.items)
      .filter((item) => item.kind === "task" && !item.locked && item.status !== "completed")
      .slice(0, MAX_OPS_PER_OPTION);
    expect(later.length).toBeGreaterThan(1);
    const result = check(later.map((item) => op({ op: "pull_forward", item_id: item.id })), fixture);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.warnings).toEqual([]);
    const updated = new Map(result.result.updated_days.map((day) => [day.date, day]));
    const afterDays = fixture.beforeDays.map((day) => updated.get(day.date) ?? day);
    // どのタスクも今週の合計は変わらない（今日に入らない分は明日以降に戻る）
    for (const taskId of new Set(later.map((item) => item.task_id!))) {
      expect(taskMinutes(afterDays, taskId)).toBe(taskMinutes(fixture.beforeDays, taskId));
    }
    // 今日に入った分は、今日のタスクの上限（360分）を超えない
    expect(taskMinutes([updated.get(TODAY)!], "task_report") + taskMinutes([updated.get(TODAY)!], "task_es_a")).toBeLessThanOrEqual(360);
  });

  it("締切後の日を指定した postpone：置けなければ errors（締切に間に合わない）", () => {
    const fixture = chatFixture();
    const report = findBefore(fixture, TUESDAY, (item) => item.task_id === "task_report");
    // ゼミレポート（締切 10/9）を今日に前倒ししてから、土曜（10/10）に回すよう指定する
    const result = check([
      op({ op: "pull_forward", item_id: report.id }),
      op({ op: "postpone", item_id: report.id, date: "2026-10-10" }),
    ], fixture);
    expect(result).toEqual({ ok: false, errors: ["ゼミレポート「地域経済の課題」が締切（10/9）に間に合いません"], engineErrors: [] });
  });

  it("add_event 19:00〜21:00：夕食と重なり errors", () => {
    const result = check([op({ op: "add_event", title: "飲み会", start: "19:00", end: "21:00" })]);
    expect(result).toEqual({ ok: false, errors: ["夕食（19:00〜19:45）と重なるため入れられません"], engineErrors: [] });
  });

  it("終わりの時刻がない予定は1時間で仮置きし、warnings に C-10 の一文", () => {
    const result = check([op({ op: "add_event", title: "散歩", start: "21:00" })]);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.newFixedEvents).toEqual([expect.objectContaining({ start_at: at(TODAY, "21:00"), end_at: at(TODAY, "22:00") })]);
    expect(result.warnings).toContain(PROVISIONAL_END_NOTE);
    expect(result.result.proposal.intent.new_fixed_events).toEqual(result.newFixedEvents);
  });

  it("add_rest now：進行中のタスクを切っても errors 0（allowedInProgressTaskSplitIds）", () => {
    const result = check([op({ op: "add_rest", start: "now", minutes: 20 })]);
    expect(result.ok).toBe(true);
  });

  it("tired_plan がほかの操作と同じ案にある → errors", () => {
    const result = check([op({ op: "tired_plan" }), op({ op: "delay", minutes: 30 })]);
    expect(result).toEqual({ ok: false, errors: ["tired_plan はほかの操作と同じ案に入れられません。tired_plan だけの案にしてください"], engineErrors: [] });
  });

  it("tired_plan だけの案：今の replan()（state_change・high）と同じ結果", () => {
    const fixture = chatFixture();
    const result = check([op({ op: "tired_plan" })], fixture, "high");
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const engine = replan(fixture.context, fixture.beforeDays, { type: "state_change", fatigue: "high", task_changes: [], new_fixed_events: [], preference_changes: [] });
    expect(result.result).toEqual(engine);
    expect(result.newFixedEvents).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.result.proposal.after.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "free", start_at: at(TODAY, "18:00"), end_at: at(TODAY, "18:30") }),
      expect.objectContaining({ kind: "task", task_id: "task_toeic_vocab", start_at: at(TODAY, "18:30"), end_at: at(TODAY, "18:50") }),
      expect.objectContaining({ kind: "buffer", start_at: at(TODAY, "18:50"), end_at: at(TODAY, "19:00") }),
    ]));
    // fatigue が分からないときも high として扱う
    const unknown = check([op({ op: "tired_plan" })], fixture, null);
    expect(unknown.ok && unknown.result).toEqual(engine);
    expect(() => buildReplanRows({ result: result.result, storedRows: new Map(), userId: "user-1", weeklyPlanId: "plan-1", newId: idFactory("row") })).not.toThrow();
  }, 30_000);

  it("tired_plan で Engine の検証が失敗 → 理由は engineErrors にも入る", () => {
    const fixture = chatFixture();
    // 目標の実施済みを実際と合わない値にして、replan() の検証（週合計）を失敗させる
    fixture.context.goal_done_minutes = { goal_toeic: 60 };
    const result = check([op({ op: "tired_plan" })], fixture, "high");
    if (result.ok) throw new Error("通らないはず");
    expect(result.errors).toEqual([expect.stringContaining("再計画後の検証に失敗しました")]);
    expect(result.engineErrors).toEqual(result.errors);
  }, 30_000);

  it("操作が1つもない案は errors", () => {
    expect(check([])).toEqual({ ok: false, errors: ["操作が1つもありません"], engineErrors: [] });
  });
});

describe("checkOption：予定・タスクを足す（replan-add.md 12.19・12.23）", () => {
  const LATER_DATES = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];

  it("操作が8個以上の案は errors", () => {
    const ops = Array.from({ length: MAX_OPS_PER_OPTION + 1 }, () => op({ op: "delay", minutes: 5 }));
    expect(check(ops)).toEqual({ ok: false, errors: ["操作は1つの案に7個までです"], engineErrors: [] });
  });

  it("add_task 120分・締切 10/9：errors 0、newTasks が1件（足したタスクを context に入れて検査する）", () => {
    const result = check([op({ op: "add_task", title: "統計レポート", minutes: 120, deadline_date: "2026-10-09" })]);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.newTasks).toEqual([expect.objectContaining({ title: "統計レポート", deadline_at: "2026-10-09T23:59:00+09:00", estimated_minutes: 120 })]);
    expect(result.warnings).toEqual([]);
    expect(taskMinutes(result.result.updated_days, result.newTasks[0].id)).toBe(120);
  });

  it("add_task 締切 10/14（来週）・600分：今週に入る分だけ置き、warnings「…の残り{N}分は来週の計画で考えます」", () => {
    const fixture = chatFixture();
    for (const date of LATER_DATES.slice(2)) blockFreeTime(fixture, date);
    const result = check([op({ op: "add_task", title: "卒論", minutes: 600, deadline_date: "2026-10-14" })], fixture);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const placed = taskMinutes(result.result.updated_days, result.newTasks[0].id);
    expect(placed).toBeGreaterThan(0);
    expect(placed).toBeLessThan(600);
    expect(result.warnings).toEqual([`卒論の残り${600 - placed}分は来週の計画で考えます`]);
  });

  it("空きが足りない週に締切タスクを足す：目標の行動が外れ、warnings は「今週のTOEIC学習が60分足りなくなります」だけ。締切タスクは置かれる", () => {
    const fixture = chatFixture();
    for (const date of LATER_DATES) blockFreeTime(fixture, date);
    const result = check([op({ op: "add_task", title: "申込書", minutes: 60, deadline_date: TODAY })], fixture);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.warnings).toEqual(["今週のTOEIC学習が60分足りなくなります"]);
    expect(taskMinutes(result.result.updated_days, result.newTasks[0].id)).toBe(60);
    expect(taskMinutes(result.result.updated_days, "task_toeic_listening")).toBe(0);
  });

  it("目標の行動を全部外しても入らない → errors「…締切に間に合いません」（回ごとに重ねない）", () => {
    const result = check([op({ op: "add_task", title: "申込書", minutes: 180, deadline_date: TODAY })]);
    expect(result).toEqual({ ok: false, errors: ["申込書が締切（10/5）に間に合いません"], engineErrors: [] });
  });

  it("予定を足して空き時間が60分を下回る日 → errors 0、warnings に1件。もともと下回っていた日は出さない", () => {
    const fixture = chatFixture();
    // 10/9 は変える前から空き時間が60分を下回る日にしておく
    blockFreeTime(fixture, "2026-10-09");
    const result = check([
      op({ op: "add_event", title: "用事", date: "2026-10-08", start: "11:20", end: "12:00" }),
      op({ op: "add_event", title: "用事", date: "2026-10-08", start: "13:00", end: "18:00" }),
      op({ op: "add_event", title: "用事", date: "2026-10-08", start: "20:00", end: "24:00" }),
      op({ op: "add_event", title: "用事", date: "2026-10-09", start: "08:00", end: "08:15" }),
    ], fixture);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.result.updated_days.map((day) => day.date)).toEqual(expect.arrayContaining(["2026-10-08", "2026-10-09"]));
    expect(result.warnings).toEqual(["10/8の空き時間が30分になります（めやすは60分）"]);
  });
});
