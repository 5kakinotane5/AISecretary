import { describe, expect, it } from "vitest";
import { summarizePlan as summarizeMockPlan } from "@/lib/mock/summarize";
import { ScheduleItemSchema, type DayPlan, type ScheduleItem } from "@/lib/schemas";
import { BALANCED_PLAN } from "@/mocks/plans/balanced";
import { summarizePlan } from "../summarize";
import { createPlanningContext } from "./fixtures";

const date = "2026-10-05";

function task(id: string, taskId: string, start: string, end: string): ScheduleItem {
  return ScheduleItemSchema.parse({
    id,
    kind: "task",
    title: id,
    start_at: `${date}T${start}:00+09:00`,
    end_at: `${date}T${end}:00+09:00`,
    location_id: "loc_home",
    task_id: taskId,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
  });
}

describe("summarizePlan（planning.md 10.12）", () => {
  it("balancedモックと既存集計が一致し、補正C-9のoverloadを使う", () => {
    const context = createPlanningContext();
    const explanation = BALANCED_PLAN.summary.explanation;
    const current = summarizePlan(context, BALANCED_PLAN.days, explanation);
    const legacy = summarizeMockPlan(BALANCED_PLAN.days, explanation);
    expect({ ...current, overload: legacy.overload }).toEqual(legacy);
    expect(current.overload).toBe(
      BALANCED_PLAN.days.some((day) => {
        const minutes = day.items
          .filter((item) => item.kind === "task")
          .reduce(
            (total, item) =>
              total +
              (new Date(item.end_at).getTime() - new Date(item.start_at).getTime()) / 60000,
            0,
          );
        return minutes > context.preferences.daily_work_limit_minutes * 0.8;
      }),
    );
  });

  it("目標タスク時間と締切タスクの異なる件数を計算する", () => {
    const context = createPlanningContext();
    const days: DayPlan[] = [
      {
        date,
        items: [
          task("goal-1", "task_toeic_listening", "08:00", "09:00"),
          task("goal-2", "task_toeic_vocab", "09:00", "09:30"),
          task("deadline-1", "task_report", "10:00", "11:00"),
          task("deadline-2", "task_report", "11:00", "12:00"),
          task("deadline-3", "task_es_a", "13:00", "14:00"),
        ],
      },
    ];
    const summary = summarizePlan(context, days, "説明");
    expect(summary.goal_hours).toBe(1.5);
    expect(summary.deadline_task_count).toBe(2);
    expect(summary.explanation).toBe("説明");
  });

  it("作業上限の80%ちょうどはoverload=false、超えるとtrue", () => {
    const context = createPlanningContext();
    context.preferences.daily_work_limit_minutes = 100;
    const exact = [{ date, items: [task("exact", "task_report", "08:00", "09:20")] }];
    const over = [{ date, items: [task("over", "task_report", "08:00", "09:21")] }];
    expect(summarizePlan(context, exact, "").overload).toBe(false);
    expect(summarizePlan(context, over, "").overload).toBe(true);
  });

  it("入力を変更せず、同じ入力から完全に同じJSONを返す", () => {
    const context = createPlanningContext();
    const days = structuredClone(BALANCED_PLAN.days);
    const contextBefore = structuredClone(context);
    const daysBefore = structuredClone(days);
    const first = summarizePlan(context, days, "同じ説明");
    const second = summarizePlan(context, days, "同じ説明");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(context).toEqual(contextBefore);
    expect(days).toEqual(daysBefore);
  });
});
