import { atJstTime, diffMinutesExact } from "@/lib/datetime";
import type { Goal } from "@/lib/schemas";

const CATEGORY_INITIAL_HOURS: Readonly<Record<string, number>> = {
  "資格・テスト勉強": 6,
  "筋トレ・運動": 3,
  "大学の課題・レポート": 4,
  就活: 5,
  その他: 4,
};

export type GoalCandidateHoursInput = {
  category: Goal["category"];
  deadline: Goal["deadline"];
  today: string;
  explicit_hours_per_week: number | null;
  frequency_per_week: number | null;
  main_minutes: number;
  weekly_free_minutes: number;
};

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function clampHours(value: number): number {
  return Math.min(15, Math.max(1, roundHalf(value)));
}

function deadlineFactor(deadline: string | null, today: string): number {
  if (deadline === null) return 1;
  const days = diffMinutesExact(atJstTime(today, "00:00"), atJstTime(deadline, "00:00")) / 1440;
  const weeks = Math.ceil(days / 7);
  if (weeks <= 4) return 1.5;
  if (weeks <= 8) return 1.2;
  return 1;
}

/** backend.md 7.2: 文章を含めず、3案の週あたり時間だけを決定する。 */
export function computeGoalCandidateHours(input: GoalCandidateHoursInput): {
  intensive: number;
  balanced: number;
  paced: number;
} {
  const initialHours = CATEGORY_INITIAL_HOURS[input.category] ?? CATEGORY_INITIAL_HOURS["その他"];
  const base =
    input.explicit_hours_per_week ??
    (input.frequency_per_week === null
      ? initialHours * deadlineFactor(input.deadline, input.today)
      : (input.frequency_per_week * input.main_minutes) / 60);

  let intensive = clampHours(base * 1.5);
  let balanced = clampHours(base);
  let paced = clampHours(base * 0.5);

  const capacity = Math.max(3, Math.floor(((input.weekly_free_minutes / 60) * 0.4) * 2) / 2);
  intensive = Math.min(intensive, capacity);
  balanced = Math.min(balanced, intensive - 0.5);
  paced = Math.min(paced, balanced - 0.5);

  if (paced < 1) {
    paced = 1;
    balanced = Math.max(balanced, 1.5);
    intensive = Math.max(intensive, 2);
  }

  return { intensive, balanced, paced };
}
