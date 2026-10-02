import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/datetime";
import { expandFixedEvents } from "@/lib/planning/skeleton";
import { buildNewTaskRows, buildReplanRows } from "@/lib/server/replan-rows";
import type { PlannedItem, ReplanOpLlm } from "@/lib/schemas";
import { applyOps, type ApplyOpsResult } from "../apply-ops";
import { at, blockFreeTime, chatFixture, findBefore, idFactory, op, TODAY, todayItems, validateApplied, type ChatFixture } from "./helpers";

const TUESDAY = "2026-10-06";
const WEDNESDAY = "2026-10-07";
const THURSDAY = "2026-10-08";

function run(ops: ReplanOpLlm[], fixture: ChatFixture = chatFixture(), newId: () => string = idFactory()) {
  const applied = applyOps({ context: fixture.context, beforeDays: fixture.beforeDays, ops, newId });
  return { fixture, applied, ...validateApplied(fixture, applied) };
}

const listening = (fixture: ChatFixture) => findBefore(fixture, TODAY, (item) => item.task_id === "task_toeic_listening");
const stats = (fixture: ChatFixture) =>
  fixture.beforeDays[0].items.filter((item) => item.task_id === "task_stats_hw" && item.start_at >= fixture.context.now);
const tasksAfterNow = (items: PlannedItem[]) => items.filter((item) => item.kind === "task" && item.start_at >= at(TODAY, "18:00"));

// 3案の生成（chatFixture の初回）は重いので、各テストの時間に数えないよう先に1回だけ行う
beforeAll(() => {
  chatFixture();
}, 60_000);

describe("applyOps（replan-chat.md 12.10）", () => {
  it("add_event 20:00〜22:00：予定を入れ、重なるタスクは後ろか明日以降に回る", () => {
    const { fixture, applied, validation } = run([op({ op: "add_event", title: "飲み会", start: "20:00", end: "22:00" })]);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.newFixedEvents).toEqual([
      expect.objectContaining({ title: "飲み会", category: "other", location_id: null, recurrence: null, start_at: at(TODAY, "20:00"), end_at: at(TODAY, "22:00") }),
    ]);
    const today = todayItems(applied);
    const event = today.find((item) => item.kind === "fixed" && item.title === "飲み会")!;
    expect(event).toMatchObject({ fixed_event_id: applied.newFixedEvents[0].id, fixed_category: "other", reason: "20:00からの予定を入れました", reason_code: "FIXED_EVENT_ADDED" });
    expect(today.filter((item) => item.kind === "task" && item.start_at < event.end_at && event.start_at < item.end_at)).toEqual([]);
    // リスニングは予定の後ろ（前へは詰めない）、入らない統計学は明日以降
    expect(today.find((item) => item.task_id === "task_toeic_listening")).toMatchObject({ start_at: at(TODAY, "22:00"), end_at: at(TODAY, "23:00") });
    const moved = applied.result.proposal.other_day_changes.filter((change) => change.before?.task_id === "task_stats_hw");
    expect(moved.length + applied.unplaced.length).toBe(stats(fixture).length);
    expect(applied.result.proposal.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_type: "added", reason: "20:00からの予定を入れました" }),
      expect.objectContaining({ change_type: "moved", moved_to_date: null }),
    ]));
    // タスクとバッファは就寝の30分前（23:30）まで
    expect(today.filter((item) => item.kind === "task" || item.kind === "buffer").every((item) => item.end_at <= at(TODAY, "23:30"))).toBe(true);
  });

  it("add_event 19:00〜21:00：夕食と重なり opErrors", () => {
    const { applied } = run([op({ op: "add_event", title: "飲み会", start: "19:00", end: "21:00" })]);
    expect(applied.opErrors).toEqual(["夕食（19:00〜19:45）と重なるため入れられません"]);
    expect(applied.newFixedEvents).toEqual([]);
  });

  it("add_rest now 20分：進行中の ES を now で切り、18:00〜18:20 休憩、ES の残りがその後", () => {
    const fixture = chatFixture();
    const es = findBefore(fixture, TODAY, (item) => item.task_id === "task_es_b" && item.locked);
    const { applied, validation } = run([op({ op: "add_rest", title: "仮眠", start: "now", minutes: 20 })], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.splitTaskIds).toEqual([es.id]);
    const today = todayItems(applied);
    expect(today.find((item) => item.id === es.id)).toMatchObject({ start_at: es.start_at, end_at: at(TODAY, "18:00"), locked: true, status: "completed", reason: es.reason, reason_code: es.reason_code });
    const rest = today.find((item) => item.reason_code === "REST")!;
    expect(rest).toMatchObject({ kind: "free", title: "仮眠", start_at: at(TODAY, "18:00"), end_at: at(TODAY, "18:20"), reason: "少し休んで、回復してから続けます" });
    expect(today.find((item) => item.task_id === "task_es_b" && item.id !== es.id)).toMatchObject({ start_at: at(TODAY, "18:20"), end_at: at(TODAY, "18:55"), locked: false });
    expect(tasksAfterNow(today).every((item) => item.start_at >= rest.end_at)).toBe(true);
    const replaced = applied.result.proposal.changes.find((change) => change.change_type === "replaced")!;
    expect(replaced.before?.id).toBe(es.id);
    expect(replaced.after.map((item) => [item.start_at, item.end_at])).toEqual([
      [es.start_at, at(TODAY, "18:00")],
      [at(TODAY, "18:20"), at(TODAY, "18:55")],
    ]);
  });

  it("delay 30：進行中の ES の終わりから、夕食の手前までふさぐ。変わらない項目の id はそのまま", () => {
    const fixture = chatFixture();
    const { applied, validation } = run([op({ op: "delay", minutes: 30 })], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    const today = todayItems(applied);
    expect(today.find((item) => item.title === "前の予定の延長")).toMatchObject({ kind: "free", start_at: at(TODAY, "18:35"), end_at: at(TODAY, "19:00"), reason: "前の予定が延びた分をあけました", reason_code: null });
    // タスク・夕食・終わった項目は中身も時刻も変わらないので id も同じ
    const unchanged = fixture.beforeDays[0].items.filter((item) => item.kind !== "free" && item.kind !== "buffer");
    for (const item of unchanged) expect(today).toContainEqual(item);
    // 変更のない日は updated_days に入らない
    expect(applied.result.updated_days.map((day) => day.date)).toEqual([TODAY]);
    expect(applied.result.proposal.changes.map((change) => change.change_type)).toEqual(["added"]);
  });

  it("reorder：統計学を先に、リスニングを後に（前へ詰めるのは先頭に来たものだけ）", () => {
    const fixture = chatFixture();
    const [firstStats, secondStats] = stats(fixture);
    const { applied, validation } = run([op({ op: "reorder", item_ids: [firstStats.id, listening(fixture).id] })], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    const today = tasksAfterNow(todayItems(applied)).filter((item) => item.task_id !== "task_es_b");
    expect(today.map((item) => [item.task_id, item.start_at.slice(11, 16), item.end_at.slice(11, 16)])).toEqual([
      ["task_stats_hw", "19:45", "20:15"],
      ["task_toeic_listening", "20:30", "21:30"],
      ["task_stats_hw", "22:15", "22:45"],
    ]);
    expect(todayItems(applied)).toContainEqual(secondStats);
  });

  it("reorder：キューにある id が1つもなければ opErrors", () => {
    const { applied } = run([op({ op: "reorder", item_ids: ["nope"] })]);
    expect(applied.opErrors).toHaveLength(1);
  });

  it("shorten：統計学を20分に短くする", () => {
    const fixture = chatFixture();
    const [firstStats] = stats(fixture);
    const { applied, validation } = run([op({ op: "shorten", item_id: firstStats.id, minutes: 22 })], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.skippedGoalMinutes).toBe(0);
    const shortened = applied.result.proposal.changes.find((change) => change.change_type === "shortened")!;
    expect(shortened.before?.id).toBe(firstStats.id);
    expect(shortened.after).toEqual([expect.objectContaining({ start_at: firstStats.start_at, end_at: at(TODAY, "21:50"), reason: "統計学の課題を20分に短くしました" })]);
    expect(todayItems(applied).find((item) => item.id === shortened.after[0].id)?.reason_code).toBe("USER_SHORTENED");
  });

  it("shorten：10分未満・今の長さ以上・キューにないものは opErrors", () => {
    const fixture = chatFixture();
    const [firstStats] = stats(fixture);
    const { applied } = run([
      op({ op: "shorten", item_id: firstStats.id, minutes: 5 }),
      op({ op: "shorten", item_id: firstStats.id, minutes: 30 }),
      op({ op: "shorten", item_id: "nope", minutes: 20 }),
    ], fixture);
    expect(applied.opErrors).toHaveLength(3);
  });

  it("postpone（date なし）：リスニングを明日以降に回す", () => {
    const fixture = chatFixture();
    const { applied, validation } = run([op({ op: "postpone", item_id: listening(fixture).id })], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(todayItems(applied).some((item) => item.task_id === "task_toeic_listening")).toBe(false);
    const moved = applied.result.proposal.other_day_changes.find((change) => change.before?.id === listening(fixture).id)!;
    expect(moved).toMatchObject({ change_type: "moved", moved_to_date: TUESDAY, reason: "TOEIC リスニング演習を火曜に回しました" });
    expect(moved.after[0]).toMatchObject({ kind: "task", start_at: at(TUESDAY, "17:00"), end_at: at(TUESDAY, "18:00") });
    expect(applied.result.proposal.changes).toContainEqual(expect.objectContaining({ change_type: "moved", moved_to_date: TUESDAY, after: [] }));
    const tuesday = applied.result.updated_days.find((day) => day.date === TUESDAY)!;
    expect(tuesday.items.find((item) => item.start_at === at(TUESDAY, "17:00"))?.reason_code).toBe("USER_POSTPONED");
    expect(applied.result.updated_days.map((day) => day.date)).toEqual([TODAY, TUESDAY]);
  });

  it("postpone（date あり）：指定の日に回す", () => {
    const fixture = chatFixture();
    const { applied, validation } = run([op({ op: "postpone", item_id: listening(fixture).id, date: THURSDAY })], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    const moved = applied.result.proposal.other_day_changes.find((change) => change.before?.id === listening(fixture).id)!;
    expect(moved).toMatchObject({ moved_to_date: THURSDAY, reason: "TOEIC リスニング演習を木曜に回しました" });
  });

  it("pull_forward（明日のタスクを今日の先頭に）", () => {
    const fixture = chatFixture();
    const report = findBefore(fixture, TUESDAY, (item) => item.task_id === "task_report");
    // 今日のタスクの上限（360分）に入るよう、リスニングを明日以降に回してから前倒しする
    const { applied, validation } = run([
      op({ op: "postpone", item_id: listening(fixture).id }),
      op({ op: "pull_forward", item_id: report.id, position: "first" }),
    ], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    const today = tasksAfterNow(todayItems(applied)).filter((item) => item.task_id !== "task_es_b");
    expect(today[0]).toMatchObject({ task_id: "task_report", start_at: at(TODAY, "19:45"), end_at: at(TODAY, "21:15") });
    expect(applied.result.proposal.changes).toContainEqual(expect.objectContaining({ change_type: "moved", before: expect.objectContaining({ id: report.id }), moved_to_date: TODAY }));
    const tuesday = applied.result.updated_days.find((day) => day.date === TUESDAY)!;
    expect(tuesday.items.some((item) => item.id === report.id)).toBe(false);
  });

  it("move_to_day：指定の日へ。締切より後・明日〜日曜でない日は opErrors", () => {
    const fixture = chatFixture();
    const esA = findBefore(fixture, "2026-10-07", (item) => item.task_id === "task_es_a");
    const ok = run([op({ op: "move_to_day", item_id: listening(fixture).id, date: THURSDAY })], fixture);
    expect(ok.applied.opErrors).toEqual([]);
    expect(ok.validation.errors).toEqual([]);
    const bad = run([
      op({ op: "move_to_day", item_id: listening(fixture).id, date: TODAY }),
      op({ op: "move_to_day", item_id: esA.id, date: "2026-10-13" }),
    ], fixture);
    expect(bad.applied.opErrors).toHaveLength(2);
  });

  it("tired_plan がほかの操作と同じ案にあれば opErrors", () => {
    const { applied } = run([op({ op: "tired_plan" }), op({ op: "add_rest", start: "now" })]);
    expect(applied.opErrors).toContain("tired_plan はほかの操作と同じ案に入れられません。tired_plan だけの案にしてください");
  });

  it("結果を buildReplanRows() に渡しても例外が出ない", () => {
    const fixture = chatFixture();
    const cases: ReplanOpLlm[][] = [
      [op({ op: "add_event", title: "飲み会", start: "20:00", end: "22:00" })],
      [op({ op: "add_rest", start: "now", minutes: 20 })],
      [op({ op: "postpone", item_id: listening(fixture).id })],
    ];
    for (const ops of cases) {
      const { applied } = run(ops, fixture);
      const rows = buildReplanRows({ result: applied.result, storedRows: new Map(), userId: "user-1", weeklyPlanId: "plan-1", newId: idFactory("row") });
      expect(rows.updatedDays.length).toBe(applied.result.updated_days.length);
    }
  });
});

const dayItems = (applied: ApplyOpsResult, date: string) => applied.result.updated_days.find((day) => day.date === date)!.items;
const span = (item: PlannedItem) => [item.kind, item.start_at.slice(11, 16), item.end_at.slice(11, 16)];
const allChanges = (applied: ApplyOpsResult) => [...applied.result.proposal.changes, ...applied.result.proposal.other_day_changes];
const placedOf = (applied: ApplyOpsResult, taskId: string) =>
  applied.result.updated_days.flatMap((day) => day.items).filter((item) => item.kind === "task" && item.task_id === taskId);

describe("applyOps：予定・タスクを足す（replan-add.md 12.18・12.23）", () => {
  it("add_event once 10/8 15:00〜16:00：自由時間が前後に分かれ、errors 0", () => {
    const { applied, validation } = run([op({ op: "add_event", title: "面接", date: THURSDAY, start: "15:00", end: "16:00", category: "social" })]);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.newFixedEvents).toEqual([
      expect.objectContaining({ title: "面接", category: "social", location_id: null, recurrence: null, start_at: at(THURSDAY, "15:00"), end_at: at(THURSDAY, "16:00") }),
    ]);
    const thursday = dayItems(applied, THURSDAY);
    expect(thursday.filter((item) => item.start_at >= at(THURSDAY, "13:00") && item.end_at <= at(THURSDAY, "18:00")).map(span)).toEqual([
      ["free", "13:00", "15:00"],
      ["fixed", "15:00", "16:00"],
      ["free", "16:00", "18:00"],
    ]);
    expect(thursday.find((item) => item.kind === "fixed" && item.title === "面接")).toMatchObject({
      fixed_event_id: applied.newFixedEvents[0].id,
      fixed_category: "social",
      locked: true,
      reason: "15:00からの予定を入れました",
      reason_code: "FIXED_EVENT_ADDED",
    });
    expect(applied.result.proposal.other_day_changes).toEqual([
      expect.objectContaining({ change_type: "added", before: null, reason: "15:00からの予定を入れました" }),
    ]);
    expect(applied.result.updated_days.map((day) => day.date)).toEqual([TODAY, THURSDAY]);
  });

  it("add_event once 10/8 17:30〜18:30：重なるタスク（リスニング）は外れて別の時間に移り、errors 0", () => {
    const fixture = chatFixture();
    const thursdayListening = findBefore(fixture, THURSDAY, (item) => item.task_id === "task_toeic_listening");
    const { applied, validation } = run([op({ op: "add_event", title: "面接", date: THURSDAY, start: "17:30", end: "18:30" })], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.unplaced).toEqual([]);
    const event = dayItems(applied, THURSDAY).find((item) => item.title === "面接")!;
    expect(span(event)).toEqual(["fixed", "17:30", "18:30"]);
    expect(dayItems(applied, THURSDAY).filter((item) => item.kind === "task" && item.start_at < event.end_at && event.start_at < item.end_at)).toEqual([]);
    const moved = applied.result.proposal.other_day_changes.find((change) => change.before?.id === thursdayListening.id)!;
    expect(moved.change_type).toBe("moved");
    expect(moved.after[0]).toMatchObject({ kind: "task", task_id: "task_toeic_listening" });
  });

  it("add_event once 10/8 で授業と重なる → opErrors", () => {
    const { applied } = run([op({ op: "add_event", title: "面接", date: THURSDAY, start: "10:00", end: "11:00" })]);
    expect(applied.opErrors).toEqual(["1限 計量経済学（9:00〜10:30）と重なるため入れられません"]);
    expect(applied.newFixedEvents).toEqual([]);
  });

  it("add_event once 10/12（来週）・今日以外で start が now → opErrors", () => {
    const { applied } = run([
      op({ op: "add_event", title: "面接", date: "2026-10-12", start: "15:00", end: "16:00" }),
      op({ op: "add_event", title: "散歩", date: THURSDAY, start: "now", minutes: 30 }),
    ]);
    expect(applied.opErrors).toEqual([
      "今週（10/11まで）の1回きりの予定だけ入れられます。毎週の予定なら入れられます",
      "今日以外の予定（散歩）は開始の時刻（HH:MM）で教えてください",
    ]);
    expect(applied.newFixedEvents).toEqual([]);
  });

  it("add_event weekly 水 18:00〜19:00：start_at は 10/7、10/7 に項目が置かれ、errors 0。DB から読み直した形（expandFixedEvents）でも通る", () => {
    const fixture = chatFixture();
    const { applied, validation } = run([op({ op: "add_event", title: "ジム", repeat: "weekly", weekday: "水", start: "18:00", end: "19:00" })], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.newFixedEvents).toEqual([
      expect.objectContaining({ title: "ジム", category: "other", recurrence: "weekly", start_at: at(WEDNESDAY, "18:00"), end_at: at(WEDNESDAY, "19:00") }),
    ]);
    expect(dayItems(applied, WEDNESDAY).find((item) => item.title === "ジム")).toMatchObject({
      kind: "fixed",
      fixed_event_id: applied.newFixedEvents[0].id,
      start_at: at(WEDNESDAY, "18:00"),
      end_at: at(WEDNESDAY, "19:00"),
    });
    // 次の会話で DB から読み直したとき（planning-context.ts と同じ展開）の fixed_events でも、固定予定の一致の検査が通る
    const weekStart = fixture.context.week_start;
    const reloaded = expandFixedEvents([...fixture.context.fixed_events, ...applied.newFixedEvents], weekStart, addDays(weekStart, 6), { purpose: "planning_context" });
    expect(reloaded.filter((event) => event.id === applied.newFixedEvents[0].id)).toEqual([applied.newFixedEvents[0]]);
    expect(validateApplied(fixture, applied, reloaded).validation.errors).toEqual([]);
  });

  it("add_event weekly 月 9:00〜10:00（今日だがもう過ぎた）：start_at は来週の 10/12 9:00。今週の項目は増えない", () => {
    const fixture = chatFixture();
    const { applied, validation } = run([op({ op: "add_event", title: "自習", repeat: "weekly", weekday: "月", start: "9:00", end: "10:00" })], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.newFixedEvents).toEqual([
      expect.objectContaining({ recurrence: "weekly", start_at: at("2026-10-12", "09:00"), end_at: at("2026-10-12", "10:00") }),
    ]);
    const fixedOf = (items: PlannedItem[]) => items.filter((item) => item.kind === "fixed");
    expect(fixedOf(todayItems(applied))).toEqual(fixedOf(fixture.beforeDays[0].items));
    expect(applied.result.updated_days.map((day) => day.date)).toEqual([TODAY]);
    expect(allChanges(applied).filter((change) => change.change_type === "added")).toEqual([]);
  });

  it("add_event weekly 月 20:00〜21:00（今日のこれから）：start_at は 10/5 20:00、今日に項目が置かれる", () => {
    const { applied, validation } = run([op({ op: "add_event", title: "ジム", repeat: "weekly", weekday: "月", start: "20:00", end: "21:00" })]);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.newFixedEvents).toEqual([expect.objectContaining({ recurrence: "weekly", start_at: at(TODAY, "20:00") })]);
    expect(todayItems(applied).find((item) => item.title === "ジム")).toMatchObject({ kind: "fixed", start_at: at(TODAY, "20:00"), end_at: at(TODAY, "21:00") });
  });

  it("add_event weekly：start が now・null なら opErrors", () => {
    const { applied } = run([
      op({ op: "add_event", title: "ジム", repeat: "weekly", weekday: "水", start: "now", minutes: 60 }),
      op({ op: "add_event", title: "ジム", repeat: "weekly", weekday: "水", start: null, minutes: 60 }),
    ]);
    expect(applied.opErrors).toEqual(["毎週の予定（ジム）は開始の時刻（HH:MM）で教えてください", "毎週の予定（ジム）は開始の時刻（HH:MM）で教えてください"]);
    expect(applied.newFixedEvents).toEqual([]);
  });

  it("1つの案に add_event once を3つ（別の日）：3日とも置かれ、errors 0", () => {
    const { applied, validation } = run([
      op({ op: "add_event", title: "スーパー", date: TUESDAY, start: "17:00", minutes: 30 }),
      op({ op: "add_event", title: "スーパー", date: THURSDAY, start: "15:00", minutes: 30 }),
      op({ op: "add_event", title: "スーパー", date: "2026-10-11", start: "16:00", minutes: 30 }),
    ]);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.newFixedEvents.map((event) => event.start_at)).toEqual([at(TUESDAY, "17:00"), at(THURSDAY, "15:00"), at("2026-10-11", "16:00")]);
    for (const date of [TUESDAY, THURSDAY, "2026-10-11"]) {
      expect(dayItems(applied, date).filter((item) => item.title === "スーパー")).toHaveLength(1);
    }
  });

  it("add_task 120分・締切 10/9：明日（10/6）から 60分×2 で置かれ、締切前に終わる。errors 0", () => {
    const { applied, validation } = run([op({ op: "add_task", title: "統計レポート", minutes: 120, deadline_date: "2026-10-09" })]);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.newTasks).toEqual([
      {
        id: expect.any(String),
        title: "統計レポート",
        goal_id: null,
        deadline_at: "2026-10-09T23:59:00+09:00",
        estimated_minutes: 120,
        remaining_minutes: 120,
        importance: "medium",
        concentration: "medium",
        splittable: true,
        interruptible: true,
        buffer_fit: "low",
        status: "not_started",
      },
    ]);
    const placed = placedOf(applied, applied.newTasks[0].id);
    expect(placed.map((item) => [item.start_at.slice(0, 10), (Date.parse(item.end_at) - Date.parse(item.start_at)) / 60_000])).toEqual([
      [TUESDAY, 60],
      [WEDNESDAY, 60],
    ]);
    expect(placed.every((item) => item.end_at <= "2026-10-09T23:59:00+09:00")).toBe(true);
    expect(placed.map((item) => [item.reason, item.reason_code])).toEqual([
      ["10/9の締切に間に合うように入れました", null],
      ["10/9の締切に間に合うように入れました", null],
    ]);
    expect(applied.unplaced).toEqual([]);
    expect(applied.result.proposal.other_day_changes.filter((change) => change.change_type === "added")).toHaveLength(2);
  });

  it("add_task 30分・締切 10/6：今日の cut 以降か 10/6 に置かれる", () => {
    const { applied, validation } = run([op({ op: "add_task", title: "申込", minutes: 30, deadline_date: TUESDAY, deadline_time: "12:00", importance: "high" })]);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(applied.newTasks[0]).toMatchObject({ deadline_at: at(TUESDAY, "12:00"), importance: "high", estimated_minutes: 30 });
    const placed = placedOf(applied, applied.newTasks[0].id);
    expect(placed).toHaveLength(1);
    expect(placed[0].start_at >= at(TODAY, "18:00") && placed[0].end_at <= at(TUESDAY, "12:00")).toBe(true);
  });

  it("add_task：締切が過ぎている・所要時間や締切がない → opErrors", () => {
    const { applied } = run([
      op({ op: "add_task", title: "申込", minutes: 30, deadline_date: TODAY, deadline_time: "17:00" }),
      op({ op: "add_task", title: "申込", minutes: null, deadline_date: TUESDAY }),
      op({ op: "add_task", title: "申込", minutes: 30, deadline_date: null }),
    ]);
    expect(applied.opErrors).toEqual(["申込の締切が過ぎています", "申込の所要時間（minutes）がありません", "申込の締切の日付（deadline_date）がありません"]);
    expect(applied.newTasks).toEqual([]);
  });

  it("add_task 198分：5分に切り上げて200分、90分以下の回に分ける（70・65・65）", () => {
    const { applied, validation } = run([op({ op: "add_task", title: "卒論", minutes: 198, deadline_date: "2026-10-11" })]);
    expect(validation.errors).toEqual([]);
    expect(applied.newTasks[0].estimated_minutes).toBe(200);
    const lengths = placedOf(applied, applied.newTasks[0].id).map((item) => (Date.parse(item.end_at) - Date.parse(item.start_at)) / 60_000);
    expect(lengths.sort((a, b) => b - a)).toEqual([70, 65, 65]);
  });

  it("今日：キューの目標の行動の後ろに締切タスクがあって全部は入らない → 締切タスクが今日に残り、目標の行動が溢れる", () => {
    const fixture = chatFixture();
    const [firstStats, secondStats] = stats(fixture);
    const report = findBefore(fixture, TUESDAY, (item) => item.task_id === "task_report");
    const { applied, validation } = run([
      op({ op: "postpone", item_id: firstStats.id }),
      op({ op: "postpone", item_id: secondStats.id }),
      op({ op: "add_event", title: "飲み会", start: "21:30", end: "23:00" }),
      op({ op: "pull_forward", item_id: report.id, position: "last" }),
    ], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors).toEqual([]);
    const today = tasksAfterNow(todayItems(applied));
    expect(today.map((item) => [item.task_id, item.start_at.slice(11, 16), item.end_at.slice(11, 16)])).toEqual([["task_report", "19:45", "21:15"]]);
    const moved = applied.result.proposal.other_day_changes.find((change) => change.before?.id === listening(fixture).id)!;
    expect(moved.change_type).toBe("moved");
    expect(moved.moved_to_date! > TODAY).toBe(true);
  });

  it("空きのない週に今日締切のタスクを足す：今日の目標の行動を外して置き、外した目標の行動は unplaced（goal_id 付き）", () => {
    const fixture = chatFixture();
    for (let date = TUESDAY; date <= "2026-10-11"; date = addDays(date, 1)) blockFreeTime(fixture, date);
    const { applied, validation } = run([op({ op: "add_task", title: "申込書", minutes: 60, deadline_date: TODAY })], fixture);
    expect(applied.opErrors).toEqual([]);
    expect(validation.errors.filter((issue) => issue.code !== "GOAL_HOURS_MISMATCH")).toEqual([]);
    expect(todayItems(applied).some((item) => item.task_id === "task_toeic_listening")).toBe(false);
    expect(placedOf(applied, applied.newTasks[0].id).map((item) => item.start_at.slice(0, 10))).toEqual([TODAY]);
    expect(applied.unplaced).toEqual([{ task_id: "task_toeic_listening", title: "TOEIC リスニング演習", minutes: 60, deadline_at: null, goal_id: "goal_toeic" }]);
  });

  it("結果を buildReplanRows() に渡して例外が出ない。new_tasks の行は tasks の列の形、new_fixed_events の行に recurrence が入る", () => {
    const fixture = chatFixture();
    // run.ts と同じく newId は UUID（tasks.id・fixed_events.id は uuid の列）
    const { applied } = run([
      op({ op: "add_task", title: "統計レポート", minutes: 120, deadline_date: "2026-10-09" }),
      op({ op: "add_event", title: "ジム", repeat: "weekly", weekday: "水", start: "18:00", end: "19:00" }),
      op({ op: "add_event", title: "面接", date: THURSDAY, start: "15:00", end: "16:00" }),
    ], fixture, () => crypto.randomUUID());
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(applied.newTasks[0].id).toMatch(uuid);
    expect(applied.newFixedEvents.every((event) => uuid.test(event.id))).toBe(true);
    const rows = buildReplanRows({ result: applied.result, storedRows: new Map(), userId: "user-1", weeklyPlanId: "plan-1", newId: idFactory("row") });
    expect(rows.updatedDays.length).toBe(applied.result.updated_days.length);

    // supabase/migrations/0001_init.sql の tasks・fixed_events の列
    const taskColumns = ["id", "user_id", "title", "goal_id", "deadline_at", "estimated_minutes", "remaining_minutes", "importance", "concentration", "splittable", "interruptible", "buffer_fit", "status", "created_at"];
    const fixedEventColumns = ["id", "user_id", "title", "category", "location_id", "start_at", "end_at", "recurrence"];
    const taskRows = buildNewTaskRows({ tasks: applied.newTasks, userId: "user-1", now: fixture.context.now });
    expect(taskRows).toHaveLength(1);
    expect(Object.keys(taskRows[0]).sort()).toEqual([...taskColumns].sort());
    expect(taskRows[0]).toMatchObject({ id: applied.newTasks[0].id, user_id: "user-1", created_at: fixture.context.now, goal_id: null });
    // run.ts の new_fixed_events の行と同じ形
    const fixedRows = applied.newFixedEvents.map((event) => ({ ...event, user_id: "user-1" }));
    for (const row of fixedRows) expect(Object.keys(row).sort()).toEqual([...fixedEventColumns].sort());
    expect(fixedRows.map((row) => row.recurrence)).toEqual(["weekly", null]);
  });
});
