import { CHECKIN_LABELS } from "./labels";
import type { DailyCheckin } from "./schemas";

/** /today の「今日の調子」で選べる3項目（frontend.md 14.2） */
export type CheckinLevels = Pick<DailyCheckin, "mood" | "fatigue" | "concentration">;

/**
 * 「AIに相談する」で /replan に送る文。調子が悪い側でなければ null（ボタンを出さない）。
 * 優先順：疲労 high → 疲労 medium → 集中 low → 気分 low（frontend.md 14.2）。
 * チェックインを変えても計画は自動では作り直さない（FR-08-14）。この文を送るのは利用者がボタンを押したときだけ
 */
export function consultTextFor({ mood, fatigue, concentration }: CheckinLevels): string | null {
  const text = CHECKIN_LABELS.consultText;
  if (fatigue === "high") return text.fatigueHigh;
  if (fatigue === "medium") return text.fatigueMedium;
  if (concentration === "low") return text.concentrationLow;
  if (mood === "low") return text.moodLow;
  return null;
}
