import type { DayPlan, EngineReplanResult, PlanningContext } from "@/lib/schemas";
import type { ReplanningIntent } from "./replan-intent";
import { toDateStr } from "@/lib/datetime";

// TODO: 長沼の ★6（lib/planning/replan.ts）がマージされたら、このファイルを消し、
// app/api/plans/replan/route.ts の import を `import { replan } from "@/lib/planning/replan"` に替える。
//
// 仮の Engine（planning.md 10.2 の replan(context, beforeDays, intent) と同じ形）。
// 今日の計画を変えずに返す（changes は0件）。API の流れ（提案の保存 → accept → /today）を確かめるためのもの。
// mocks/replan-tired をそのまま返すと、項目の task_id などが DB の UUID と合わず accept で失敗するため、こうしている
export function replan(
  context: PlanningContext,
  beforeDays: DayPlan[],
  intent: ReplanningIntent,
): EngineReplanResult {
  const today = toDateStr(context.now);
  const before = beforeDays.find((day) => day.date === today) ?? { date: today, items: [] };
  return {
    ok: true,
    proposal: {
      date: today,
      intent,
      before,
      after: before,
      changes: [],
      other_day_changes: [],
      summary_message: "（仮）再計画の Engine をつなぐ前のため、計画は変わっていません。",
    },
    updated_days: [
      { date: today, items: before.items.map((item) => ({ ...item, reason_code: null })) },
    ],
  };
}
