import { diffMinutesExact, formatMonthDay, toDateStr, addDays } from "@/lib/datetime";
import type {
  EngineReplanResult,
  FixedEvent,
  Level,
  PlannedItem,
  PlanningContext,
  ReplanOpLlm,
} from "@/lib/schemas";
import { replan } from "@/lib/planning/replan";
import { validatePlan } from "@/lib/planning/validate";
import { PROVISIONAL_END_NOTE } from "@/lib/server/replan-intent";
import { applyOps } from "./apply-ops";

// 会話の再計画：1つの案を検査する（replan-chat.md 12.11「1つの案を検査する」）。
// 純粋関数（DB・LLM・時計・環境変数に触れない）。errors・warnings は日本語の文（errors は LLM に返す）

type EngineReplanOk = Extract<EngineReplanResult, { ok: true }>;

export type CheckOptionInput = {
  context: PlanningContext; // 12.2 の 6 で作ったもの（locked_items 込み。足す予定は入れない）
  beforeDays: readonly { date: string; items: PlannedItem[] }[]; // 12.2 の engineBeforeDays
  option: { label: string; ops: readonly ReplanOpLlm[] };
  fatigue: Level | null; // 発言から分かる疲れ（12.9 の ReplanChatLlm.fatigue）
  newId: () => string;
};

export type CheckOptionResult =
  | { ok: true; result: EngineReplanOk; newFixedEvents: FixedEvent[]; warnings: string[] }
  | { ok: false; errors: string[] };

export function checkOption(input: CheckOptionInput): CheckOptionResult {
  const { context, beforeDays, option, fatigue } = input;
  if (option.ops.length === 0) return { ok: false, errors: ["操作が1つもありません"] };

  // 1. tired_plan だけの案：Engine（12.4 A）。medium も high と同じ処理になる
  if (option.ops.length === 1 && option.ops[0].op === "tired_plan") {
    const result = replan(context, beforeDays, {
      type: "state_change",
      fatigue: fatigue === "medium" ? "medium" : "high",
      task_changes: [],
      new_fixed_events: [],
      preference_changes: [],
    });
    if (!result.ok) return { ok: false, errors: [result.infeasible.reason] };
    return { ok: true, result, newFixedEvents: [], warnings: [] };
  }

  // 2. それ以外：applyOps → validatePlan
  const applied = applyOps({ context, beforeDays, ops: option.ops, newId: input.newId });
  const validationContext: PlanningContext = {
    ...context,
    fixed_events: [...context.fixed_events, ...applied.newFixedEvents],
  };
  const updated = new Map(applied.result.updated_days.map((day) => [day.date, day]));
  const afterDays = beforeDays.map((day) => updated.get(day.date) ?? day);
  const validation = validatePlan(validationContext, afterDays, "replan", {
    before: beforeDays,
    allowedInProgressTaskSplitIds: applied.splitTaskIds,
  });

  // 3. errors と warnings に分ける
  const errors = [...applied.opErrors];
  const warnings: string[] = [];
  for (const issue of validation.errors) {
    if (issue.code !== "GOAL_HOURS_MISMATCH") errors.push(issue.message);
  }
  // 目標の週合計の不足（Validator の GOAL_HOURS_MISMATCH と同じ式。想定 − 実際）。足りないときは warnings、多いときは errors
  if (validation.errors.some((issue) => issue.code === "GOAL_HOURS_MISMATCH")) {
    const items = afterDays.flatMap((day) => day.items);
    for (const goal of context.goals) {
      const taskIds = new Set(context.tasks.filter((task) => task.goal_id === goal.id).map((task) => task.id));
      const actual = items
        .filter(
          (item) =>
            item.kind === "task" &&
            item.task_id !== null &&
            taskIds.has(item.task_id) &&
            Date.parse(item.end_at) > Date.parse(context.now),
        )
        .reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0);
      const expected = Math.max(
        0,
        (context.goal_week_target_minutes[goal.id] ?? 0) - (context.goal_done_minutes[goal.id] ?? 0),
      );
      if (actual < expected) warnings.push(`今週の${goal.task_name}が${expected - actual}分足りなくなります`);
      else if (actual > expected) errors.push(`${goal.task_name}の週合計が${actual}分で、想定の${expected}分より多くなります`);
    }
  }
  const sunday = addDays(context.week_start, 6);
  for (const task of applied.unplaced) {
    if (task.deadline_at !== null && toDateStr(task.deadline_at) <= sunday) {
      errors.push(`${task.title}が締切（${formatMonthDay(task.deadline_at)}）に間に合いません`);
    } else {
      warnings.push(`${task.title}は今週に入りませんでした`);
    }
  }
  if (applied.provisionalEnd) warnings.push(PROVISIONAL_END_NOTE);

  if (errors.length > 0) return { ok: false, errors };

  // 会話の経路の intent（12.9）：互換のための値。画面では使わない
  const result: EngineReplanOk = {
    ...applied.result,
    proposal: {
      ...applied.result.proposal,
      intent: { ...applied.result.proposal.intent, fatigue, preference_changes: [option.label] },
    },
  };
  return { ok: true, result, newFixedEvents: applied.newFixedEvents, warnings };
}
