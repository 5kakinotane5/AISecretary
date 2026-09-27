import type { INTERVIEW_CATEGORIES } from "@/lib/schemas";

// 目標時間3案の数値（backend.md 7.2、planning.md の computeGoalCandidateHours）の仮の関数。
// 引数・戻り値は lib/planning/goal-candidates.ts（担当B）と同じにしてある。

export type GoalCandidateHoursInput = {
  category: (typeof INTERVIEW_CATEGORIES)[number];
  deadline: string | null; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  explicit_hours_per_week: number | null;
  frequency_per_week: number | null;
  main_minutes: number; // 8.2 のテンプレートのメインの1回の分
  weekly_free_minutes: number; // now〜日曜の空きの合計分（7.2.2 の上限）
};

export type GoalCandidateHours = { intensive: number; balanced: number; paced: number };

// TODO: 担当B の lib/planning/goal-candidates.ts ができたら、このファイルを消し、
// 呼び出し元の import を "@/lib/planning/goal-candidates" に差し替える。
// 今は入力によらず G1（mocks/goal.ts）の計算結果と同じ 9 / 6 / 3 を返す（G1 以外の回答では数値が合わない）
export function computeGoalCandidateHours(input: GoalCandidateHoursInput): GoalCandidateHours {
  void input;
  return { intensive: 9, balanced: 6, paced: 3 };
}
