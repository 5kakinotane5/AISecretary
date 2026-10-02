import { beforeAll, describe, expect, it } from "vitest";
import { diffMinutesExact } from "@/lib/datetime";
import { replan } from "@/lib/planning/replan";
import type { ReplanOpLlm } from "@/lib/schemas";
import { buildReplanRows } from "@/lib/server/replan-rows";
import { PROVISIONAL_END_NOTE } from "@/lib/server/replan-intent";
import { checkOption } from "../check";
import { at, chatFixture, findBefore, idFactory, op, TODAY, type ChatFixture } from "./helpers";

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

  it("明日以降のタスクを全部 pull_forward：errors 0、溢れた分は元の日か別の日に戻る", () => {
    const fixture = chatFixture();
    const later = fixture.beforeDays
      .filter((day) => day.date > TODAY)
      .flatMap((day) => day.items)
      .filter((item) => item.kind === "task" && !item.locked && item.status !== "completed");
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
    expect(result).toEqual({ ok: false, errors: ["ゼミレポート「地域経済の課題」が締切（10/9）に間に合いません"] });
  });

  it("add_event 19:00〜21:00：夕食と重なり errors", () => {
    const result = check([op({ op: "add_event", title: "飲み会", start: "19:00", end: "21:00" })]);
    expect(result).toEqual({ ok: false, errors: ["夕食（19:00〜19:45）と重なるため入れられません"] });
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
    expect(result).toEqual({ ok: false, errors: ["tired_plan はほかの操作と同じ案に入れられません。tired_plan だけの案にしてください"] });
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

  it("操作が1つもない案は errors", () => {
    expect(check([])).toEqual({ ok: false, errors: ["操作が1つもありません"] });
  });
});
