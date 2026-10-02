import { diffMinutesExact, formatMonthDay, toDateStr, addDays } from "@/lib/datetime";
import type {
  EngineReplanResult,
  FixedEvent,
  Level,
  PlannedItem,
  PlanningContext,
  ReplanOpLlm,
  ScheduleItem,
  Task,
} from "@/lib/schemas";
import { replan } from "@/lib/planning/replan";
import { validatePlan } from "@/lib/planning/validate";
import { PROVISIONAL_END_NOTE } from "@/lib/server/replan-intent";
import { applyOps } from "./apply-ops";

// 会話の再計画：1つの案を検査する（replan-chat.md 12.11「1つの案を検査する」、replan-add.md 12.19）。
// 純粋関数（DB・LLM・時計・環境変数に触れない）。errors・warnings は日本語の文（errors は LLM に返す）

type EngineReplanOk = Extract<EngineReplanResult, { ok: true }>;

// 終わりの時刻を仮置きした予定（補正 C-10）。会話の経路では、終わりの時刻を聞く一文を足す
export const PROVISIONAL_END_WARNING = `${PROVISIONAL_END_NOTE}終わりの時刻が分かれば教えてください。`;

// 1つの案の操作の上限（replan-add.md 12.17）
export const MAX_OPS_PER_OPTION = 7;

export type CheckOptionInput = {
  context: PlanningContext; // 12.2 の 6 で作ったもの（locked_items 込み。足す予定は入れない）
  beforeDays: readonly { date: string; items: PlannedItem[] }[]; // 12.2 の engineBeforeDays
  option: { label: string; ops: readonly ReplanOpLlm[] };
  fatigue: Level | null; // 発言から分かる疲れ（12.9 の ReplanChatLlm.fatigue）
  newId: () => string;
};

export type CheckOptionResult =
  | { ok: true; result: EngineReplanOk; newFixedEvents: FixedEvent[]; newTasks: Task[]; warnings: string[] }
  // errors はすべての理由（LLM の feedback に使う）。engineErrors はそのうち Engine・Validator が出したもの
  // （利用者には見せず、サーバーのログにだけ出す）
  | { ok: false; errors: string[]; engineErrors: string[] };

export function checkOption(input: CheckOptionInput): CheckOptionResult {
  const { context, beforeDays, option, fatigue } = input;
  if (option.ops.length === 0) return { ok: false, errors: ["操作が1つもありません"], engineErrors: [] };
  if (option.ops.length > MAX_OPS_PER_OPTION) {
    return { ok: false, errors: [`操作は1つの案に${MAX_OPS_PER_OPTION}個までです`], engineErrors: [] };
  }

  // 1. tired_plan だけの案：Engine（12.4 A）。medium も high と同じ処理になる
  if (option.ops.length === 1 && option.ops[0].op === "tired_plan") {
    const result = replan(context, beforeDays, {
      type: "state_change",
      fatigue: fatigue === "medium" ? "medium" : "high",
      task_changes: [],
      new_fixed_events: [],
      preference_changes: [],
    });
    if (!result.ok) return { ok: false, errors: [result.infeasible.reason], engineErrors: [result.infeasible.reason] };
    return { ok: true, result, newFixedEvents: [], newTasks: [], warnings: [] };
  }

  // 2. それ以外：applyOps → validatePlan
  const applied = applyOps({ context, beforeDays, ops: option.ops, newId: input.newId });
  // 足した予定・タスクも入れる（INVALID_REFERENCE・DEADLINE_VIOLATION・固定予定の時刻の一致を正しく見るため）
  const validationContext: PlanningContext = {
    ...context,
    tasks: [...context.tasks, ...applied.newTasks],
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
  const engineErrors: string[] = [];
  const warnings: string[] = [];
  for (const issue of validation.errors) {
    if (issue.code !== "GOAL_HOURS_MISMATCH") {
      errors.push(issue.message);
      engineErrors.push(issue.message);
    }
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
      else if (actual > expected) {
        const message = `${goal.task_name}の週合計が${actual}分で、想定の${expected}分より多くなります`;
        errors.push(message);
        engineErrors.push(message);
      }
    }
  }
  const sunday = addDays(context.week_start, 6);
  const newTaskIds = new Set(applied.newTasks.map((task) => task.id));
  const nextWeek = new Map<string, { title: string; minutes: number }>();
  for (const task of applied.unplaced) {
    if (task.deadline_at !== null && toDateStr(task.deadline_at) <= sunday) {
      const message = `${task.title}が締切（${formatMonthDay(task.deadline_at)}）に間に合いません`;
      if (!errors.includes(message)) errors.push(message);
    } else if (newTaskIds.has(task.task_id)) {
      // 足したタスクで締切が来週以降：入らない分（回の合計）は来週の計画で考える（replan-add.md 12.18）
      const entry = nextWeek.get(task.task_id) ?? { title: task.title, minutes: 0 };
      nextWeek.set(task.task_id, { ...entry, minutes: entry.minutes + task.minutes });
    } else if (task.goal_id === null) {
      // 目標の行動は GOAL_HOURS_MISMATCH の「今週の…が N 分足りなくなります」だけにする（二重に出さない）
      const message = `${task.title}は今週に入りませんでした`;
      if (!warnings.includes(message)) warnings.push(message);
    }
  }
  for (const { title, minutes } of nextWeek.values()) warnings.push(`${title}の残り${minutes}分は来週の計画で考えます`);
  // 1日のバッファ＋自由時間の合計が最低を下回った日（Validator の warnings）：この案で変わった日で、変える前は下回っていなかった日だけ
  const minRest = context.preferences.min_daily_buffer_minutes;
  const beforeByDate = new Map(beforeDays.map((day) => [day.date, day.items]));
  for (const day of applied.result.updated_days) {
    const short = validation.warnings.some(
      (issue) => issue.code === "BUFFER_SHORTAGE" && issue.item_id === null && issue.date === day.date,
    );
    if (!short || restMinutes(beforeByDate.get(day.date) ?? []) < minRest) continue;
    warnings.push(`${formatMonthDay(day.date)}の空き時間が${restMinutes(day.items)}分になります（めやすは${minRest}分）`);
  }
  if (applied.provisionalEnd) warnings.push(PROVISIONAL_END_WARNING);

  if (errors.length > 0) return { ok: false, errors, engineErrors };

  // 会話の経路の intent（12.9）：互換のための値。画面では使わない
  const result: EngineReplanOk = {
    ...applied.result,
    proposal: {
      ...applied.result.proposal,
      intent: { ...applied.result.proposal.intent, fatigue, preference_changes: [option.label] },
    },
  };
  return { ok: true, result, newFixedEvents: applied.newFixedEvents, newTasks: applied.newTasks, warnings };
}

// 1日のバッファ＋自由時間の合計（Validator の BUFFER_SHORTAGE と同じ数え方）
function restMinutes(items: readonly ScheduleItem[]): number {
  return items
    .filter((item) => item.kind === "buffer" || item.kind === "free")
    .reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0);
}
