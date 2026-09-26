import type { PlanningContext } from "@/lib/schemas";
import { FIXED_EVENTS } from "@/mocks/fixed-events";
import { GOAL } from "@/mocks/goal";
import { LOCATIONS, LOCATION_IDS, TRAVEL_TIMES, USER_PREFERENCE } from "@/mocks/persona";
import { TASKS } from "@/mocks/tasks";

/** planning.md 10.14・P14 の基準入力。呼び出すたびに独立したコピーを返す。 */
export function createPlanningContext(): PlanningContext {
  return structuredClone({
    now: "2026-10-05T07:00:00+09:00",
    week_start: "2026-10-05",
    style: null,
    preferences: USER_PREFERENCE,
    home_location_id: LOCATION_IDS.home,
    locations: LOCATIONS,
    travel_times: TRAVEL_TIMES,
    // モックは基準週の月〜日へ展開済み。元のid・時刻を保つ。
    fixed_events: FIXED_EVENTS,
    goals: [GOAL], // mock-spec の G1 = goal_toeic
    goal_week_target_minutes: { [GOAL.id]: 360 },
    goal_done_minutes: { [GOAL.id]: 0 },
    goal_time_bands: { [GOAL.id]: { weekday: "evening", weekend: null } },
    // 目標タスク2件の remaining_minutes は同じ R = 360 を共有（足し合わせない）。
    tasks: TASKS,
    checkin: null,
    locked_items: [],
  } satisfies PlanningContext);
}
