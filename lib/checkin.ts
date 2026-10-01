import { CHECKIN_LABELS } from "./labels";
import type { DailyCheckin, Level } from "./schemas";

/** /today の「今日の調子」で選べる3項目（frontend.md 14.2） */
export type CheckinLevels = Pick<DailyCheckin, "mood" | "fatigue" | "concentration">;

/**
 * 調子が悪い側の値か：気分 low、疲労 medium・high、集中 low（frontend.md 14.2）。
 * 「AIに相談する」を出す条件（consultTextFor）と、確定後の1行の総合の判定（overallCondition）の両方に使う
 */
export function isUnwellLevel(field: keyof CheckinLevels, level: Level): boolean {
  switch (field) {
    case "mood":
      return level === "low";
    case "fatigue":
      return level === "medium" || level === "high";
    case "concentration":
      return level === "low";
  }
}

/**
 * 「AIに相談する」で /replan に送る文。調子が悪い側でなければ null（ボタンを出さない）。
 * 優先順：疲労 high → 疲労 medium → 集中 low → 気分 low（frontend.md 14.2）。
 * チェックインを変えても計画は自動では作り直さない（FR-08-14）。この文を送るのは利用者がボタンを押したときだけ
 */
export function consultTextFor({ mood, fatigue, concentration }: CheckinLevels): string | null {
  const text = CHECKIN_LABELS.consultText;
  if (fatigue && isUnwellLevel("fatigue", fatigue)) return fatigue === "high" ? text.fatigueHigh : text.fatigueMedium;
  if (concentration && isUnwellLevel("concentration", concentration)) return text.concentrationLow;
  if (mood && isUnwellLevel("mood", mood)) return text.moodLow;
  return null;
}

/** 3つとも入っている（null でない）チェックイン */
export type CompleteCheckinLevels = { [K in keyof CheckinLevels]: NonNullable<CheckinLevels[K]> };

/**
 * 確定済みか：今日の checkin があり、気分・疲労・集中が3つとも null でない（frontend.md 14.2）。
 * 確定済みなら /today は1行の表示にして、もう選ばせない（ロックは画面側だけ。API は上書きできる）
 */
export function isCheckinComplete(levels: CheckinLevels | null): levels is CompleteCheckinLevels {
  return levels !== null && levels.mood !== null && levels.fatigue !== null && levels.concentration !== null;
}

/** 確定後の1行に出す総合の調子（frontend.md 14.2） */
export type OverallCondition = "good" | "normal" | "tired";

/**
 * 総合の調子：疲労 high、または調子が悪い側が2つ以上 → tired、1つ → normal、0 → good（frontend.md 14.2）。
 * 悪い側の判定は consultTextFor と同じ isUnwellLevel を使う
 */
export function overallCondition(levels: CompleteCheckinLevels): OverallCondition {
  const unwell = [
    isUnwellLevel("mood", levels.mood),
    isUnwellLevel("fatigue", levels.fatigue),
    isUnwellLevel("concentration", levels.concentration),
  ].filter(Boolean).length;
  if (levels.fatigue === "high" || unwell >= 2) return "tired";
  return unwell === 1 ? "normal" : "good";
}
