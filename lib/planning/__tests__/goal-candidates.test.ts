import { describe, expect, it } from "vitest";
import { computeGoalCandidateHours } from "../goal-candidates";

const today = "2026-10-05";

describe("computeGoalCandidateHours（backend.md 7.2・7.3）", () => {
  it.each([
    ["資格・テスト勉強", "2026-12-13", null, null, 60, 2400, [9, 6, 3]],
    ["資格・テスト勉強", null, 5, null, 60, 2400, [7.5, 5, 2.5]],
    ["その他", null, 1, null, 60, 2400, [2, 1.5, 1]],
    ["その他", null, 12, null, 60, 2400, [15, 12, 6]],
    ["資格・テスト勉強", "2026-12-13", null, null, 60, 600, [4, 3.5, 3]],
    ["筋トレ・運動", null, null, 3, 45, 2400, [3.5, 2.5, 1]],
    ["就活", "2026-10-26", null, null, 60, 2400, [11.5, 7.5, 4]],
  ] as const)(
    "%s: intensive / balanced / paced を設計表どおり計算する",
    (category, deadline, explicit, frequency, mainMinutes, weeklyFreeMinutes, expected) => {
      const result = computeGoalCandidateHours({
        category,
        deadline,
        today,
        explicit_hours_per_week: explicit,
        frequency_per_week: frequency,
        main_minutes: mainMinutes,
        weekly_free_minutes: weeklyFreeMinutes,
      });
      expect([result.intensive, result.balanced, result.paced]).toEqual(expected);
    },
  );

  it("デモ条件のTOEIC・10週・明示時間なしは9 / 6 / 3時間になる", () => {
    expect(
      computeGoalCandidateHours({
        category: "資格・テスト勉強",
        deadline: "2026-12-13",
        today,
        explicit_hours_per_week: null,
        frequency_per_week: null,
        main_minutes: 60,
        weekly_free_minutes: 2400,
      }),
    ).toEqual({ intensive: 9, balanced: 6, paced: 3 });
  });
});
