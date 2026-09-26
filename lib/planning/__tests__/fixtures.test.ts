import { describe, expect, it } from "vitest";
import { PlanningContextSchema } from "@/lib/schemas";
import { FIXED_EVENTS } from "@/mocks/fixed-events";
import { GOAL } from "@/mocks/goal";
import { LOCATIONS, LOCATION_IDS, TRAVEL_TIMES, USER_PREFERENCE } from "@/mocks/persona";
import { TASKS } from "@/mocks/tasks";
import { createPlanningContext } from "./fixtures";

describe("PlanningContext fixture（planning.md 10.14）", () => {
  it("PlanningContextSchema.parseを通る", () => {
    const context = createPlanningContext();
    expect(PlanningContextSchema.parse(context)).toEqual(context);
  });

  it("基準時刻・週・生成モードで、チェックインとlocked_itemsがない", () => {
    const context = createPlanningContext();
    expect(context.now).toBe("2026-10-05T07:00:00+09:00");
    expect(context.week_start).toBe("2026-10-05");
    expect(context.style).toBeNull();
    expect(context.checkin).toBeNull();
    expect(context.locked_items).toEqual([]);
  });

  it("G1のW = R = 360分を目標タスク2件で共有し、平日はeveningを希望する", () => {
    const context = createPlanningContext();
    expect(context.goals).toHaveLength(1);
    const [goal] = context.goals;
    expect(goal.id).toBe("goal_toeic");
    expect(goal.target_hours_per_week).toBe(6);
    expect(context.goal_week_target_minutes).toEqual({ [goal.id]: 360 });
    expect(context.goal_done_minutes).toEqual({ [goal.id]: 0 });
    const remaining =
      context.goal_week_target_minutes[goal.id] - context.goal_done_minutes[goal.id];
    expect(remaining).toBe(360);
    expect(context.goal_time_bands).toEqual({
      [goal.id]: { weekday: "evening", weekend: null },
    });

    const goalTasks = context.tasks.filter((task) => task.goal_id === goal.id);
    expect(goalTasks).toHaveLength(2);
    expect(goalTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "task_toeic_listening",
          estimated_minutes: 60,
          concentration: "medium",
        }),
        expect.objectContaining({
          id: "task_toeic_vocab",
          estimated_minutes: 30,
          concentration: "low",
        }),
      ]),
    );
    for (const task of goalTasks) {
      expect(task.remaining_minutes).toBe(remaining);
      expect(task.deadline_at).toBeNull();
      expect(task.status).toBe("not_started");
    }
  });

  it("基準週の固定予定と場所・移動・生活設定・全タスクをモックから引き継ぐ", () => {
    const context = createPlanningContext();
    expect(context.preferences).toEqual(USER_PREFERENCE);
    expect(context.home_location_id).toBe(LOCATION_IDS.home);
    expect(context.locations).toEqual(LOCATIONS);
    expect(context.travel_times).toEqual(TRAVEL_TIMES);
    expect(context.fixed_events).toEqual(FIXED_EVENTS);
    expect(context.tasks).toEqual(TASKS);
    expect(context.goals).toEqual([GOAL]);
    expect(context.fixed_events.length).toBeGreaterThan(0);
    for (const event of context.fixed_events) {
      expect(event.start_at >= "2026-10-05T00:00:00+09:00").toBe(true);
      expect(event.end_at <= "2026-10-12T00:00:00+09:00").toBe(true);
    }
  });

  it("入力のネストした値を変更しても、別の入力・次回の入力・共有モックに影響しない", () => {
    const mocks = { USER_PREFERENCE, LOCATIONS, TRAVEL_TIMES, FIXED_EVENTS, GOAL, TASKS };
    const originalMocks = structuredClone(mocks);
    const first = createPlanningContext();
    const second = createPlanningContext();
    const originalContext = structuredClone(second);

    first.preferences.sleep_start = "23:00";
    first.locations[0].name = "変更した場所";
    first.travel_times[0].minutes = 5;
    first.fixed_events[0].title = "変更した予定";
    first.goals[0].conditions.push("変更した条件");
    first.tasks[0].remaining_minutes = 0;
    first.goal_week_target_minutes[GOAL.id] = 180;
    first.goal_done_minutes[GOAL.id] = 60;
    first.goal_time_bands[GOAL.id].weekday = "morning";
    first.tasks.pop();

    expect(first.locked_items).not.toBe(second.locked_items);
    expect(second).toEqual(originalContext);
    expect(createPlanningContext()).toEqual(originalContext);
    expect(mocks).toEqual(originalMocks);
  });
});
