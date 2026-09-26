import { describe, expect, it } from "vitest";
import type { DailyCheckin, PlanningContext, Task } from "@/lib/schemas";
import {
  computeTaskPriorities,
  computeTaskPriority,
  priorityLevelValue,
} from "../priority";
import { createPlanningContext } from "./fixtures";

const today = "2026-10-05";

function findTask(context: PlanningContext, id: string): Task {
  const task = context.tasks.find((entry) => entry.id === id);
  if (!task) throw new Error(`fixtureに${id}がありません`);
  return task;
}

function checkin(overrides: Partial<DailyCheckin> = {}): DailyCheckin {
  return {
    date: today,
    mood: null,
    fatigue: null,
    concentration: null,
    want_task_ids: [],
    avoid_task_ids: [],
    note: null,
    ...overrides,
  };
}

describe("priorityLevelValue（planning.md 10.6）", () => {
  it.each([
    ["low", 0.3],
    ["medium", 0.6],
    ["high", 1],
  ] as const)("%sを%sへ変換する", (level, expected) => {
    expect(priorityLevelValue(level)).toBe(expected);
  });
});

describe("computeTaskPriority", () => {
  it("fixtureでレポート > ES > 企業研究になる", () => {
    const context = createPlanningContext();
    const priorities = computeTaskPriorities(context, today);
    const report = priorities.find((entry) => entry.task_id === "task_report");
    const es = priorities.find((entry) => entry.task_id === "task_es_a");
    const research = priorities.find((entry) => entry.task_id === "task_research");
    expect(report?.score).toBe(0.6625);
    expect(es?.score).toBeCloseTo(0.5, 12);
    expect(research?.score).toBe(0.26);
    expect(report!.score).toBeGreaterThan(es!.score);
    expect(es!.score).toBeGreaterThan(research!.score);
  });

  it("締切タスクのD_iを残り時間とJSTの日付差から計算する", () => {
    const context = createPlanningContext();
    const task = findTask(context, "task_report");
    task.remaining_minutes = 180;
    task.deadline_at = "2026-10-09T00:01:00+09:00";
    expect(computeTaskPriority(context, task, today).components.urgency).toBe(0.75);
  });

  it.each([
    ["2026-10-05T23:59:00+09:00", 1],
    ["2026-10-04T12:00:00+09:00", 1],
  ])("締切が今日または過去なら分母を1日にする", (deadline, expected) => {
    const context = createPlanningContext();
    const task = findTask(context, "task_report");
    task.remaining_minutes = 60;
    task.deadline_at = deadline;
    expect(computeTaskPriority(context, task, today).components.urgency).toBe(expected);
  });

  it("締切日時の時刻部分ではなくJSTの日付差を使う", () => {
    const context = createPlanningContext();
    context.now = "2026-10-05T23:59:00+09:00";
    const task = findTask(context, "task_report");
    task.remaining_minutes = 60;
    task.deadline_at = "2026-10-06T00:01:00+09:00";
    expect(computeTaskPriority(context, task, today).components.urgency).toBe(1);
  });

  it("目標タスクのD_iを0.6 × R ÷ Wで計算する", () => {
    const context = createPlanningContext();
    const task = findTask(context, "task_toeic_listening");
    context.goal_week_target_minutes[task.goal_id!] = 360;
    context.goal_done_minutes[task.goal_id!] = 120;
    expect(computeTaskPriority(context, task, today).components.urgency).toBe(0.4);
  });

  it("W=0の目標はD_i=0で、有限値を返す", () => {
    const context = createPlanningContext();
    const task = findTask(context, "task_toeic_listening");
    context.goal_week_target_minutes[task.goal_id!] = 0;
    context.goal_done_minutes[task.goal_id!] = 0;
    const result = computeTaskPriority(context, task, today);
    expect(result.components.urgency).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it("締切も目標もないタスクのD_iは0", () => {
    const context = createPlanningContext();
    const task = findTask(context, "task_research");
    expect(computeTaskPriority(context, task, today).components.urgency).toBe(0);
  });

  it.each([
    ["in_progress", 1],
    ["not_started", 0.5],
  ] as const)("status=%sのU_iは%s", (status, expected) => {
    const context = createPlanningContext();
    const task = findTask(context, "task_research");
    task.status = status;
    expect(computeTaskPriority(context, task, today).components.status).toBe(expected);
  });

  it("completedには設計にないU_iを補完しない", () => {
    const context = createPlanningContext();
    const task = findTask(context, "task_research");
    task.status = "completed";
    expect(() => computeTaskPriority(context, task, today)).toThrow(RangeError);
  });

  it("今日のwantで加点し、avoidで減点する", () => {
    const context = createPlanningContext();
    const task = findTask(context, "task_research");
    context.checkin = checkin({ want_task_ids: [task.id] });
    expect(computeTaskPriority(context, task, today).components.user).toBe(1);
    context.checkin = checkin({ avoid_task_ids: [task.id] });
    expect(computeTaskPriority(context, task, today).components.user).toBe(-1);
  });

  it("今日以外はwant・avoidを反映しない", () => {
    const context = createPlanningContext();
    const task = findTask(context, "task_research");
    context.checkin = checkin({ want_task_ids: [task.id], avoid_task_ids: [task.id] });
    expect(computeTaskPriority(context, task, "2026-10-06").components.user).toBe(0);
  });

  it("チェックインなしではuser成分が0", () => {
    const context = createPlanningContext();
    const task = findTask(context, "task_research");
    expect(computeTaskPriority(context, task, today).components.user).toBe(0);
  });

  it("wantとavoidの両方にある場合は設計表の記載順でwantを先に評価する", () => {
    const context = createPlanningContext();
    const task = findTask(context, "task_research");
    context.checkin = checkin({ want_task_ids: [task.id], avoid_task_ids: [task.id] });
    expect(computeTaskPriority(context, task, today).components.user).toBe(1);
  });

  it("score降順、同点ではtask.id昇順で並べる", () => {
    const context = createPlanningContext();
    const template = findTask(context, "task_research");
    context.tasks = [
      { ...template, id: "task_z" },
      { ...template, id: "task_a" },
      { ...template, id: "task_high", importance: "high" },
    ];
    expect(computeTaskPriorities(context, today).map((entry) => entry.task_id)).toEqual([
      "task_high",
      "task_a",
      "task_z",
    ]);
  });

  it("入力を変更せず、同じ入力でJSONが一致し、全成分とscoreが有限", () => {
    const context = createPlanningContext();
    const before = structuredClone(context);
    const first = computeTaskPriorities(context, today);
    const second = computeTaskPriorities(context, today);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(context).toEqual(before);
    for (const result of first) {
      expect(Number.isFinite(result.score)).toBe(true);
      expect(Object.values(result.components).every(Number.isFinite)).toBe(true);
    }
  });
});
