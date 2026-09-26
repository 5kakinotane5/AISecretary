import { describe, expect, it } from "vitest";
import { addDays, atJstTime, diffMinutesExact } from "@/lib/datetime";
import { PlannedItemSchema, type PlanningContext, type Task } from "@/lib/schemas";
import type { AllocationQuota } from "../allocate";
import { buildWeeklyAllocation } from "../allocate";
import { CONFIG } from "../config";
import { buildWeekFromAllocation, dayBeam, enumerateFreeLengths, enumerateQuotaLengths, enumerateTaskBuffers, type DayBeamInput } from "../day-beam";
import { buildSkeleton } from "../skeleton";
import { buildFreeSlots, type FreeSlot } from "../slots";
import { createPlanningContext } from "./fixtures";

const date = "2026-10-05";

function findTask(context: PlanningContext, id: string): Task {
  const value = context.tasks.find((task) => task.id === id);
  if (!value) throw new Error(`${id}がありません`);
  return value;
}

function slot(start = "13:50", workEnd = "19:00", end = workEnd): FreeSlot {
  return { start: atJstTime(date, start), work_end: atJstTime(date, workEnd), end: atJstTime(date, end), location_id: "loc_home" };
}

function quota(context: PlanningContext, taskId: string, kind: AllocationQuota["kind"], minutes = 60, band: AllocationQuota["band"] = null): AllocationQuota {
  const task = findTask(context, taskId);
  return {
    kind,
    task_id: taskId,
    minutes,
    required: kind !== "optional",
    band,
    carryover: kind === "deadline" ? "deadline_before_due" : kind === "goal" ? "goal_next_day" : null,
    deadline_at: task.deadline_at,
    completion_target_date: null,
  };
}

function input(overrides: Partial<DayBeamInput> = {}): DayBeamInput {
  const context = createPlanningContext();
  return {
    date,
    slots: [slot()],
    quotas: [],
    weights: CONFIG.beamWeights.balanced,
    context,
    existing_items: [],
    id_prefix: "balanced",
    ...overrides,
  };
}

function taskItems(result: ReturnType<typeof dayBeam>) {
  return result.items.filter((item) => item.kind === "task");
}

describe("dayBeam（planning.md P5）", () => {
  it("P14の締切2件とevening目標をすべて置く", () => {
    const context = createPlanningContext();
    const result = dayBeam(input({
      context,
      quotas: [
        quota(context, "task_report", "deadline"),
        quota(context, "task_es_a", "deadline"),
        quota(context, "task_toeic_listening", "goal", 60, "evening"),
      ],
    }));
    expect(result.remaining.filter((entry) => entry.quota.required).map((entry) => entry.remaining_minutes)).toEqual([0, 0, 0]);
    expect(result.required_complete).toBe(true);
    expect(() => PlannedItemSchema.array().parse(result.items)).not.toThrow();
    const goal = taskItems(result).find((item) => item.task_id === "task_toeic_listening")!;
    expect(goal.start_at >= atJstTime(date, "18:00")).toBe(true);
    const deadlines = taskItems(result).filter((item) => item.task_id === "task_report" || item.task_id === "task_es_a").sort((a, b) => a.start_at.localeCompare(b.start_at));
    const between = result.items.filter((item) => item.kind === "buffer" && item.start_at >= deadlines[0].end_at && item.end_at <= deadlines[1].start_at).reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0);
    expect(between).toBeGreaterThanOrEqual(15);
  });

  it("45分以上のslotだけ先頭15分bufferを置く", () => {
    expect(dayBeam(input({ slots: [slot("13:50", "14:35")] })).items[0]).toMatchObject({ kind: "buffer", start_at: atJstTime(date, "13:50"), end_at: atJstTime(date, "14:05") });
    expect(dayBeam(input({ slots: [slot("13:50", "14:34")] })).items.some((item) => item.kind === "buffer")).toBe(false);
  });

  it("task後に余裕があれば15分以上のbufferを置く", () => {
    const context = createPlanningContext();
    const result = dayBeam(input({ context, slots: [slot("13:50", "17:00")], quotas: [quota(context, "task_report", "deadline", 60)] }));
    const task = taskItems(result)[0];
    const after = result.items.find((item) => item.kind === "buffer" && item.start_at === task.end_at);
    expect(after && diffMinutesExact(after.start_at, after.end_at)).toBeGreaterThanOrEqual(15);
  });

  it("work_endからendまでをfreeにし、就寝前へtask・bufferを置かない", () => {
    const result = dayBeam(input({ slots: [slot("19:45", "23:30", "24:00")] }));
    expect(result.items.at(-1)).toMatchObject({ kind: "free", end_at: atJstTime(date, "24:00") });
    expect(result.items.at(-1)!.start_at <= atJstTime(date, "23:30")).toBe(true);
    expect(result.items.some((item) => (item.kind === "task" || item.kind === "buffer") && item.end_at > atJstTime(date, "23:30"))).toBe(false);
  });

  it("連続するfree・bufferを統合し、0分項目を作らない", () => {
    const result = dayBeam(input({ slots: [slot("13:50", "15:50", "16:00")] }));
    expect(result.items.every((item, index, items) => diffMinutesExact(item.start_at, item.end_at) > 0 && (index === 0 || item.kind !== items[index - 1].kind || (item.kind !== "free" && item.kind !== "buffer")))).toBe(true);
  });

  it("Lengthsをquota種別・分割可否・30分未満端数どおり列挙する", () => {
    const context = createPlanningContext();
    const report = findTask(context, "task_report");
    expect(enumerateQuotaLengths(quota(context, report.id, "deadline", 75), report, 75)).toEqual([30, 45, 60, 75]);
    expect(enumerateQuotaLengths(quota(context, report.id, "deadline", 15), report, 15)).toEqual([15]);
    const mail = findTask(context, "task_mail");
    expect(enumerateQuotaLengths(quota(context, mail.id, "optional", 15), mail, 15)).toEqual([15]);
    expect(enumerateQuotaLengths(quota(context, "task_toeic_listening", "goal", 60), findTask(context, "task_toeic_listening"), 60)).toEqual([60]);
  });

  it("同じ空きの2件目には15分・30分bufferを列挙し、freeは15分を残す30分・60分だけ", () => {
    expect(enumerateTaskBuffers(false)).toEqual([0]);
    expect(enumerateTaskBuffers(true)).toEqual([15, 30]);
    expect(enumerateFreeLengths(44)).toEqual([]);
    expect(enumerateFreeLengths(45)).toEqual([30]);
    expect(enumerateFreeLengths(75)).toEqual([30, 60]);
  });

  it("日次上限・deadline・fit=0を越えて配置しない", () => {
    const context = createPlanningContext();
    context.preferences.daily_work_limit_minutes = 60;
    context.checkin = { date, mood: null, fatigue: "high", concentration: null, want_task_ids: [], avoid_task_ids: [], note: null };
    const report = quota(context, "task_report", "deadline", 120);
    report.deadline_at = atJstTime(date, "14:30");
    const result = dayBeam(input({ context, quotas: [report], existing_items: [] }));
    expect(result.dayTaskMinutes).toBeLessThanOrEqual(60);
    expect(taskItems(result)).toHaveLength(0);
  });

  it("band開始を5分へ切り上げ、15分未満の孤立freeを作らない", () => {
    const context = createPlanningContext();
    const custom = quota(context, "task_toeic_vocab", "goal", 30, "evening");
    const result = dayBeam(input({ context, slots: [{ ...slot("17:58", "18:40"), start: `${date}T17:58:30+09:00` }], quotas: [custom] }));
    const placed = taskItems(result)[0];
    expect(placed.start_at).toBe(atJstTime(date, "18:00"));
    expect(result.items.some((item) => item.kind === "free" && item.end_at === placed.start_at && diffMinutesExact(item.start_at, item.end_at) < 15)).toBe(false);
  });

  it("部分評価を有限値で返し、必須remaining最小をscoreより優先する", () => {
    const context = createPlanningContext();
    const result = dayBeam(input({ context, quotas: [quota(context, "task_report", "deadline", 60)] }));
    expect(result.remaining[0].remaining_minutes).toBe(0);
    for (const value of Object.values(result.evaluation)) expect(Number.isFinite(value)).toBe(true);
  });

  it("空きなし・work_end=startでも終了し、maxStepsを超えない", () => {
    expect(dayBeam(input({ slots: [] }))).toMatchObject({ ok: true, items: [], steps: 0 });
    const zero = dayBeam(input({ slots: [slot("13:50", "13:50", "14:00")] }));
    expect(zero.ok).toBe(true);
    expect(zero.steps).toBeLessThanOrEqual(CONFIG.beam.maxSteps);
  });

  it("入力を変更せず、同じ入力でJSONが一致する", () => {
    const context = createPlanningContext();
    const value = input({ context, quotas: [quota(context, "task_report", "deadline", 60)] });
    const before = structuredClone(value);
    const first = dayBeam(value);
    expect(JSON.stringify(dayBeam(value))).toBe(JSON.stringify(first));
    expect(value).toEqual(before);
  });

  it("状態を除重し、beam.widthとmaxStepsを超えない", () => {
    const context = createPlanningContext();
    const result = dayBeam(input({ context, quotas: [quota(context, "task_report", "deadline", 120), quota(context, "task_es_a", "deadline", 60)] }));
    expect(result.deduplicated_states).toBeGreaterThan(0);
    expect(result.max_beam_size).toBeLessThanOrEqual(CONFIG.beam.width);
    expect(result.steps).toBeLessThanOrEqual(CONFIG.beam.maxSteps);
  });
});

describe("buildWeekFromAllocation（P3.3・P5.6）", () => {
  it("fixtureの週間構築に成功し、月曜18時以降にTOEICメインを置く", () => {
    const context = createPlanningContext();
    const skeleton = buildSkeleton(context);
    if (!skeleton.ok) throw new Error(skeleton.infeasible.reason);
    const slots = buildFreeSlots(context, skeleton.days);
    const allocation = buildWeeklyAllocation(context, slots, { rho: 0.45, kappa: 0, goal_order: "early" });
    const result = buildWeekFromAllocation(context, allocation, "balanced", { skeletonDays: skeleton.days, slots });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const monday = result.days[0];
    const toeic = monday.items.find((item) => item.task_id === "task_toeic_listening");
    expect(toeic).toBeDefined();
    expect(toeic!.start_at >= atJstTime(date, "18:00")).toBe(true);
    expect(monday.items.some((item) => (item.kind === "task" || item.kind === "buffer") && item.start_at >= atJstTime(date, "23:30"))).toBe(false);
  }, 10_000);

  it("任意quotaの残りはcarryせず、締切・目標の繰り越し不能は失敗する", () => {
    const context = createPlanningContext();
    context.now = `${date}T23:00:00+09:00`;
    context.fixed_events = [];
    const emptyDays = Array.from({ length: 7 }, (_, index) => ({ date: addDays(date, index), quotas: [] as AllocationQuota[] }));
    emptyDays[0].quotas.push(quota(context, "task_research", "optional", 120));
    const optional = buildWeekFromAllocation(context, { parameters: { rho: 0.45, kappa: 1, goal_order: "early" }, days: emptyDays }, "balanced");
    expect(optional.ok).toBe(true);

    emptyDays[0].quotas = [quota(context, "task_report", "deadline", 60)];
    emptyDays[0].quotas[0].deadline_at = `${date}T23:30:00+09:00`;
    expect(buildWeekFromAllocation(context, { parameters: { rho: 0.45, kappa: 0, goal_order: "early" }, days: emptyDays }, "balanced").ok).toBe(false);
  });

  it("締切quotaと目標sessionを翌日へ繰り越す", () => {
    const context = createPlanningContext();
    context.fixed_events = [];
    const days = Array.from({ length: 7 }, (_, index) => ({ date: addDays(date, index), quotas: [] as AllocationQuota[] }));
    days[0].quotas = [quota(context, "task_report", "deadline", 60), quota(context, "task_toeic_listening", "goal", 60, "evening")];
    const slots: FreeSlot[] = [
      { ...slot("18:00", "18:30"), start: atJstTime(date, "18:00"), work_end: atJstTime(date, "18:30"), end: atJstTime(date, "18:30") },
      { start: atJstTime("2026-10-06", "18:00"), work_end: atJstTime("2026-10-06", "22:00"), end: atJstTime("2026-10-06", "22:00"), location_id: "loc_home" },
    ];
    const result = buildWeekFromAllocation(context, { parameters: { rho: 0.45, kappa: 0, goal_order: "early" }, days }, "balanced", { slots });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tuesdayTasks = result.days[1].items.filter((item) => item.kind === "task").map((item) => item.task_id);
    expect(tuesdayTasks).toEqual(expect.arrayContaining(["task_report", "task_toeic_listening"]));
  });

  it("日曜のbandで置けない目標をband=nullで再探索する", () => {
    const context = createPlanningContext();
    context.now = "2026-10-11T07:00:00+09:00";
    context.fixed_events = [];
    const sundayQuota = quota(context, "task_toeic_listening", "goal", 60, "evening");
    const days = [{ date: "2026-10-11", quotas: [sundayQuota] }];
    const slots: FreeSlot[] = [{ start: "2026-10-11T08:00:00+09:00", work_end: "2026-10-11T12:00:00+09:00", end: "2026-10-11T12:00:00+09:00", location_id: "loc_home" }];
    const result = buildWeekFromAllocation(context, { parameters: { rho: 0.45, kappa: 0, goal_order: "early" }, days }, "balanced", { slots });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.day_results[0].remaining[0].quota.band).toBeNull();
    expect(result.day_results[0].remaining[0].remaining_minutes).toBe(0);
  });

  it("fixtureの同一allocationを3方向とも構築できる", () => {
    const context = createPlanningContext();
    const skeleton = buildSkeleton(context);
    if (!skeleton.ok) throw new Error(skeleton.infeasible.reason);
    const slots = buildFreeSlots(context, skeleton.days);
    const allocation = buildWeeklyAllocation(context, slots, { rho: 0.45, kappa: 0, goal_order: "early" });
    const results = (["intensive", "balanced", "relaxed"] as const).map((direction) => buildWeekFromAllocation(context, allocation, direction, { skeletonDays: skeleton.days, slots }));
    expect(results.filter((result) => result.ok)).toHaveLength(3);
  }, 15_000);

  it("週間入力を変更せず決定論的に返す", () => {
    const context = createPlanningContext();
    const skeleton = buildSkeleton(context);
    if (!skeleton.ok) throw new Error(skeleton.infeasible.reason);
    const slots = buildFreeSlots(context, skeleton.days);
    const allocation = buildWeeklyAllocation(context, slots, { rho: 0.45, kappa: 0, goal_order: "early" });
    const before = structuredClone({ context, allocation, slots });
    const first = buildWeekFromAllocation(context, allocation, "balanced", { skeletonDays: skeleton.days, slots });
    const second = buildWeekFromAllocation(context, allocation, "balanced", { skeletonDays: skeleton.days, slots });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect({ context, allocation, slots }).toEqual(before);
  }, 10_000);
});
