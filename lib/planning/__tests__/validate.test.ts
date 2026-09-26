import { describe, expect, it } from "vitest";
import { validateMockData } from "@/lib/mock/validate";
import {
  ScheduleItemSchema,
  ValidationResultSchema,
  type DayPlan,
  type PlanningContext,
  type ScheduleItem,
} from "@/lib/schemas";
import { LOCATION_IDS } from "@/mocks/persona";
import { INTENSIVE_PLAN } from "@/mocks/plans/intensive";
import { BALANCED_PLAN } from "@/mocks/plans/balanced";
import { RELAXED_PLAN } from "@/mocks/plans/relaxed";
import { validatePlan, type ValidationMode } from "../validate";
import { createPlanningContext } from "./fixtures";

const date = "2026-10-05";
const { home, cafe, station } = LOCATION_IDS;

function iso(time: string): string {
  return `${date}T${time}:00+09:00`;
}

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return ScheduleItemSchema.parse({
    id: "item",
    kind: "free",
    title: "自由時間",
    start_at: iso("08:00"),
    end_at: iso("09:00"),
    location_id: home,
    task_id: null,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
    ...overrides,
  });
}

function day(...items: ScheduleItem[]): DayPlan[] {
  return [{ date, items }];
}

function contextWithoutGoals(): PlanningContext {
  const context = createPlanningContext();
  context.goals = [];
  context.goal_week_target_minutes = {};
  context.goal_done_minutes = {};
  context.goal_time_bands = {};
  return context;
}

function codes(result: ReturnType<typeof validatePlan>, kind: "errors" | "warnings" = "errors") {
  return result[kind].map((entry) => entry.code);
}

describe("validatePlan（planning.md 10.11）", () => {
  it.each([
    ["intensive", INTENSIVE_PLAN.days],
    ["balanced", BALANCED_PLAN.days],
    ["relaxed", RELAXED_PLAN.days],
  ])("モックの%s案はstoredでerrorsが0件", (_name, days) => {
    const result = validatePlan(createPlanningContext(), days, "stored");
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("既存モック検査の正常判定と矛盾しない", () => {
    expect(validateMockData().errors).toEqual([]);
    for (const days of [INTENSIVE_PLAN.days, BALANCED_PLAN.days, RELAXED_PLAN.days]) {
      expect(validatePlan(createPlanningContext(), days, "stored").errors).toEqual([]);
    }
  });

  it("START_AFTER_ENDを検出する", () => {
    const invalid = item({ start_at: iso("09:00"), end_at: iso("09:00") });
    expect(codes(validatePlan(contextWithoutGoals(), day(invalid), "stored"))).toContain(
      "START_AFTER_END",
    );
  });

  it("ITEM_OVERLAPを検出し、終了と開始が同時刻の隣接を許可する", () => {
    const first = item({ id: "first", start_at: iso("08:00"), end_at: iso("09:00") });
    const overlap = item({ id: "overlap", start_at: iso("08:59"), end_at: iso("10:00") });
    const adjacent = item({ id: "adjacent", start_at: iso("09:00"), end_at: iso("10:00") });
    expect(codes(validatePlan(contextWithoutGoals(), day(first, overlap), "stored"))).toContain(
      "ITEM_OVERLAP",
    );
    expect(codes(validatePlan(contextWithoutGoals(), day(first, adjacent), "stored"))).not.toContain(
      "ITEM_OVERLAP",
    );
  });

  it("固定予定への重なりと登録内容の不一致をFIXED_EVENT_OVERLAPにする", () => {
    const context = contextWithoutGoals();
    const source = context.fixed_events.find((event) => event.id === "fx_mon_breakfast");
    if (!source) throw new Error("fixtureに月曜の朝食がありません");
    const fixed = item({
      id: source.id,
      kind: "fixed",
      title: source.title,
      start_at: source.start_at,
      end_at: source.end_at,
      location_id: source.location_id,
      fixed_event_id: source.id,
      fixed_category: source.category,
    });
    const overlapping = item({ id: "overlap", start_at: iso("07:45"), end_at: iso("08:15") });
    const changed = item({ ...fixed, id: "changed", end_at: iso("08:05") });
    const result = validatePlan(context, day(fixed, overlapping, changed), "stored");
    expect(result.errors.filter((entry) => entry.code === "FIXED_EVENT_OVERLAP")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item_id: "overlap" }),
        expect.objectContaining({ item_id: "changed" }),
      ]),
    );
  });

  it("睡眠時間への配置をSLEEP_OVERLAPにする", () => {
    const sleeping = item({ id: "early", start_at: iso("07:00"), end_at: iso("07:45") });
    expect(codes(validatePlan(contextWithoutGoals(), day(sleeping), "stored"))).toContain(
      "SLEEP_OVERLAP",
    );
  });

  it("12分・3分の経路、方向、手段、所要時間を移動時間表どおり検査する", () => {
    const context = contextWithoutGoals();
    const homeTask = item({
      id: "home-task",
      kind: "task",
      title: "自宅作業",
      start_at: iso("08:00"),
      end_at: iso("09:00"),
      task_id: "task_report",
      location_id: home,
    });
    const toCafe = item({
      id: "to-cafe",
      kind: "travel",
      title: "移動",
      start_at: iso("09:00"),
      end_at: iso("09:12"),
      location_id: null,
      travel: { from_location_id: home, to_location_id: cafe, mode: "walk" },
    });
    const cafeTask = item({
      id: "cafe-task",
      kind: "task",
      title: "カフェ作業",
      start_at: iso("09:12"),
      end_at: iso("10:00"),
      task_id: "task_report",
      location_id: cafe,
    });
    const toStation = item({
      id: "to-station",
      kind: "travel",
      title: "移動",
      start_at: iso("10:00"),
      end_at: iso("10:03"),
      location_id: null,
      travel: { from_location_id: cafe, to_location_id: station, mode: "walk" },
    });
    const stationTask = item({
      id: "station-task",
      kind: "task",
      title: "駅前作業",
      start_at: iso("10:03"),
      end_at: iso("11:00"),
      task_id: "task_report",
      location_id: station,
    });
    const valid = day(homeTask, toCafe, cafeTask, toStation, stationTask);
    expect(codes(validatePlan(context, valid, "stored"))).not.toContain("TRAVEL_MISSING");

    const missing = day(homeTask, cafeTask, toStation, stationTask);
    expect(codes(validatePlan(context, missing, "stored"))).toContain("TRAVEL_MISSING");

    const wrongDuration = item({ ...toCafe, end_at: iso("09:15") });
    expect(codes(validatePlan(context, day(homeTask, wrongDuration, cafeTask), "stored"))).toContain(
      "TRAVEL_MISSING",
    );
    const wrongMode = item({
      ...toCafe,
      id: "wrong-mode",
      travel: { from_location_id: home, to_location_id: cafe, mode: "bike" },
    });
    expect(codes(validatePlan(context, day(homeTask, wrongMode, cafeTask), "stored"))).toContain(
      "TRAVEL_MISSING",
    );
  });

  it("締切超過を検出し、締切ちょうどを許可する", () => {
    const context = contextWithoutGoals();
    const task = context.tasks.find((entry) => entry.id === "task_report");
    if (!task) throw new Error("fixtureにレポートがありません");
    task.deadline_at = iso("10:00");
    const exact = item({
      id: "exact",
      kind: "task",
      title: task.title,
      start_at: iso("09:00"),
      end_at: iso("10:00"),
      task_id: task.id,
    });
    const late = item({ ...exact, id: "late", end_at: iso("10:01") });
    expect(codes(validatePlan(context, day(exact), "stored"))).not.toContain("DEADLINE_VIOLATION");
    expect(codes(validatePlan(context, day(late), "stored"))).toContain("DEADLINE_VIOLATION");
  });

  it("連続タスク間の不足をerror、明示的なbuffer＋freeの日合計不足をwarningにする", () => {
    const context = contextWithoutGoals();
    const first = item({
      id: "first",
      kind: "task",
      title: "作業1",
      start_at: iso("08:00"),
      end_at: iso("09:00"),
      task_id: "task_report",
    });
    const short = item({
      id: "short",
      kind: "task",
      title: "作業2",
      start_at: iso("09:14"),
      end_at: iso("10:00"),
      task_id: "task_es_a",
    });
    const exact = item({ ...short, id: "exact", start_at: iso("09:15") });
    expect(codes(validatePlan(context, day(first, short), "stored"))).toContain("BUFFER_SHORTAGE");
    expect(codes(validatePlan(context, day(first, exact), "stored"))).not.toContain(
      "BUFFER_SHORTAGE",
    );

    const rest59 = item({ id: "rest59", kind: "free", start_at: iso("10:00"), end_at: iso("10:59") });
    const rest60 = item({ ...rest59, id: "rest60", end_at: iso("11:00") });
    expect(codes(validatePlan(context, day(rest59), "stored"), "warnings")).toContain(
      "BUFFER_SHORTAGE",
    );
    expect(codes(validatePlan(context, day(rest60), "stored"), "warnings")).not.toContain(
      "BUFFER_SHORTAGE",
    );
  });

  it("1日の作業上限超過を検出し、上限ちょうどを許可する", () => {
    const context = contextWithoutGoals();
    context.preferences.daily_work_limit_minutes = 60;
    const exact = item({ kind: "task", task_id: "task_report", start_at: iso("08:00"), end_at: iso("09:00") });
    const over = item({ ...exact, id: "over", end_at: iso("09:01") });
    expect(codes(validatePlan(context, day(exact), "stored"))).not.toContain("DAILY_LIMIT_EXCEEDED");
    expect(codes(validatePlan(context, day(over), "stored"))).toContain("DAILY_LIMIT_EXCEEDED");
  });

  it("task・location・fixed event・suggested taskの不正参照を検出し、nullを許可する", () => {
    const context = contextWithoutGoals();
    const invalid = [
      item({ id: "bad-task", task_id: "missing-task" }),
      item({ id: "bad-location", start_at: iso("09:00"), end_at: iso("10:00"), location_id: "missing-location" }),
      item({ id: "bad-fixed", start_at: iso("10:00"), end_at: iso("11:00"), fixed_event_id: "missing-fixed" }),
      item({ id: "bad-suggested", start_at: iso("11:00"), end_at: iso("12:00"), suggested_task_id: "missing-suggested" }),
    ];
    const result = validatePlan(context, day(...invalid), "stored");
    const invalidReferences = result.errors.filter((entry) => entry.code === "INVALID_REFERENCE");
    expect(invalidReferences.map((entry) => entry.item_id)).toEqual([
      "bad-fixed",
      "bad-location",
      "bad-suggested",
      "bad-task",
    ]);
    expect(
      codes(validatePlan(context, day(item({ location_id: null })), "stored")),
    ).not.toContain("INVALID_REFERENCE");
  });

  it("contextに根拠がある実施済みタスクだけ、tasksから除外後も許可する", () => {
    const context = contextWithoutGoals();
    context.tasks = context.tasks.filter((entry) => entry.id !== "task_report");
    const completed = item({
      id: "completed-history",
      kind: "task",
      task_id: "task_report",
      status: "completed",
      locked: true,
    });
    expect(codes(validatePlan(context, day(completed), "stored"))).toContain("INVALID_REFERENCE");
    context.locked_items = [completed];
    expect(codes(validatePlan(context, day(completed), "stored"))).not.toContain(
      "INVALID_REFERENCE",
    );
  });

  it("目標時間はgenerate・replanでR、storedでWと比較する", () => {
    const context = createPlanningContext();
    context.goal_done_minutes[context.goals[0].id] = 60;
    const goalTask = item({
      id: "goal",
      kind: "task",
      title: "TOEIC",
      start_at: iso("08:00"),
      end_at: iso("13:00"),
      task_id: "task_toeic_listening",
    });
    expect(codes(validatePlan(context, day(goalTask), "generate"))).not.toContain(
      "GOAL_HOURS_MISMATCH",
    );
    expect(codes(validatePlan(context, day(goalTask), "replan"))).not.toContain(
      "GOAL_HOURS_MISMATCH",
    );
    expect(codes(validatePlan(context, day(goalTask), "stored"))).toContain(
      "GOAL_HOURS_MISMATCH",
    );

    const weekly = item({ ...goalTask, end_at: iso("14:00") });
    expect(codes(validatePlan(context, day(weekly), "stored"))).not.toContain(
      "GOAL_HOURS_MISMATCH",
    );
  });

  it.each(["generate", "replan"] as const)("%sでは過去の未ロック配置を検出する", (mode) => {
    const past = item({ id: "past", start_at: iso("06:00"), end_at: iso("06:30"), locked: false });
    expect(codes(validatePlan(contextWithoutGoals(), day(past), mode))).toContain("PAST_PLACEMENT");
  });

  it("storedではPAST_PLACEMENTを検査しない", () => {
    const past = item({ id: "past", start_at: iso("06:00"), end_at: iso("06:30"), locked: false });
    expect(codes(validatePlan(contextWithoutGoals(), day(past), "stored"))).not.toContain(
      "PAST_PLACEMENT",
    );
  });

  it("replanで保護対象の削除・時刻変更・内容変更を検出し、変更なしを許可する", () => {
    const context = contextWithoutGoals();
    const protectedItem = item({ id: "protected", locked: true });
    const completedItem = item({ id: "completed", start_at: iso("09:00"), end_at: iso("10:00"), status: "completed" });
    const before = day(protectedItem, completedItem);

    const unchanged = validatePlan(context, before, "replan", { before });
    expect(codes(unchanged)).not.toContain("LOCKED_ITEM_CHANGED");

    const deleted = validatePlan(context, day(completedItem), "replan", { before });
    expect(deleted.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "LOCKED_ITEM_CHANGED", item_id: "protected" }),
      ]),
    );

    const moved = item({ ...protectedItem, start_at: iso("08:05"), end_at: iso("09:05") });
    expect(codes(validatePlan(context, day(moved, completedItem), "replan", { before }))).toContain(
      "LOCKED_ITEM_CHANGED",
    );

    const renamed = item({ ...protectedItem, title: "変更済み" });
    expect(codes(validatePlan(context, day(renamed, completedItem), "replan", { before }))).toContain(
      "LOCKED_ITEM_CHANGED",
    );
  });

  it.each(["generate", "replan", "stored"] as ValidationMode[])(
    "%sの結果はスキーマに適合し、入力不変で決定論的",
    (mode) => {
      const context = createPlanningContext();
      const days = structuredClone(BALANCED_PLAN.days);
      const contextBefore = structuredClone(context);
      const daysBefore = structuredClone(days);
      const first = validatePlan(context, days, mode, { before: days });
      const second = validatePlan(context, days, mode, { before: days });
      expect(ValidationResultSchema.parse(first)).toEqual(first);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(context).toEqual(contextBefore);
      expect(days).toEqual(daysBefore);
    },
  );
});
