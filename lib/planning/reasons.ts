import { addMinutes, diffMinutesExact, formatMonthDay, getWeekdayJa, toDateStr } from "@/lib/datetime";
import type { DayPlan, PlanStyle, PlannedItem, PlanningContext, ReasonCode, ReplanChange, ReplanProposal, ScheduleItem, Task } from "@/lib/schemas";
import { classifyTask } from "./fit";
import type { TaskPriority } from "./priority";
import { CONFIG } from "./config";

export function timeBandLabel(startAt: string): string {
  const time = startAt.slice(11, 16);
  if (time < "10:00") return "朝";
  if (time < "12:00") return "午前";
  if (time < "17:00") return "午後";
  if (time < "19:00") return "夕方";
  return "夜";
}

export type ReasonParams = {
  deadlineAt?: string | null;
  startAt?: string;
  goalHours?: number;
  goalName?: string;
  taskName?: string;
  originalTaskName?: string;
  replacementTaskName?: string;
  date?: string;
  time?: string;
  minutes?: number;
};

/** plans-replan.md 13.2 の全理由コードを文章へ変換する公開契約。 */
export function formatReason(code: ReasonCode, params: ReasonParams = {}): string {
  const deadline = params.deadlineAt ? formatMonthDay(params.deadlineAt) : "未設定";
  const weekday = params.date ? `${getWeekdayJa(params.date)}曜` : "別の曜日";
  switch (code) {
    case "DEADLINE_EARLY": return `締切（${deadline}）より早めに終わらせるため、${params.startAt ? timeBandLabel(params.startAt) : "時間帯"}に進めます`;
    case "DEADLINE_NEAR": return `締切（${deadline}）が近いため、ここで仕上げます`;
    case "DEADLINE_STEADY": return `締切（${deadline}）に向けて、少しずつ進めます`;
    case "GOAL_ROUTINE": return `週${params.goalHours ?? 0}時間の${params.goalName ?? params.taskName ?? "目標"}のため、${params.startAt ? timeBandLabel(params.startAt) : "時間帯"}に入れました`;
    case "OPTIONAL_EXTRA": return `時間に余裕があるため、${params.taskName ?? "タスク"}を進めます`;
    case "LIGHT_TASK": return `短い時間で終わる${params.taskName ?? "タスク"}を片付けます`;
    case "LIGHT_IN_BUFFER": return `短い時間でできる${params.taskName ?? "タスク"}を候補にしました`;
    case "REST": return "まずは休憩をとって、疲れを回復します";
    case "TIRED_LIGHT": return `疲れているため、集中力が必要な${params.originalTaskName ?? params.taskName ?? "タスク"}を、短時間でできる${params.replacementTaskName ?? "軽作業"}に切り替えました`;
    case "TIRED_MOVED": return `集中力が必要な${params.taskName ?? "タスク"}は今日は避けました。締切（${deadline}）には間に合います`;
    case "GOAL_CARRYOVER": return `週${params.goalHours ?? 0}時間の目標を保つため、${weekday}に振り替えました`;
    case "BUFFER_MERGED": return "作業がなくなったため、自由時間にまとめました";
    case "FREE_EXTENDED": return "ゆっくり休めるようにしました";
    case "FIXED_EVENT_ADDED": return `${params.time ?? "時刻未定"}からの予定を入れました`;
    case "USER_POSTPONED": return `${params.taskName ?? "タスク"}を${weekday}に回しました`;
    case "USER_SKIPPED": return `${params.taskName ?? "タスク"}は今週はお休みにしました`;
    case "USER_SHORTENED": return `${params.taskName ?? "タスク"}を${params.minutes ?? 0}分に短くしました`;
    case "NEXT_WEEK": return `${params.taskName ?? "タスク"}は締切（${deadline}）に間に合うよう、来週に回します`;
  }
}

function reasonFor(code: ReasonCode, task: Task, context: PlanningContext, item: PlannedItem): string {
  const goal = context.goals.find((entry) => entry.id === task.goal_id);
  const hours = task.goal_id ? (context.goal_week_target_minutes[task.goal_id] ?? 0) / 60 : 0;
  return formatReason(code, { deadlineAt: task.deadline_at, startAt: item.start_at, goalHours: hours, goalName: goal?.task_name ?? task.title, taskName: task.title });
}

export function applyGenerationReasons(
  context: PlanningContext,
  days: readonly DayPlan[],
  style: PlanStyle,
  completionTargetDates: Readonly<Record<string, string>> = {},
): DayPlan[] {
  const tasks = new Map(context.tasks.map((task) => [task.id, task]));
  return days.map((day) => ({ date: day.date, items: day.items.map((raw) => {
    const item = raw as PlannedItem;
    if (item.kind === "buffer" && item.suggested_task_id) {
      const task = tasks.get(item.suggested_task_id);
      return task ? { ...item, reason_code: "LIGHT_IN_BUFFER" as const, reason: reasonFor("LIGHT_IN_BUFFER", task, context, item) } : { ...item, reason_code: null, reason: null };
    }
    if (item.kind !== "task" || !item.task_id) return { ...item, reason_code: null, reason: null };
    const task = tasks.get(item.task_id); if (!task) return { ...item, reason_code: null, reason: null };
    let code: ReasonCode;
    const kind = classifyTask(task);
    if (kind === "deadline") code = style === "intensive" ? "DEADLINE_EARLY" : completionTargetDates[task.id] === day.date ? "DEADLINE_NEAR" : "DEADLINE_STEADY";
    else if (kind === "goal") code = "GOAL_ROUTINE";
    else if (kind === "light") code = "LIGHT_TASK";
    else code = "OPTIONAL_EXTRA";
    return { ...item, reason_code: code, reason: reasonFor(code, task, context, item) };
  }) }));
}

export function buildExplanation(context: PlanningContext, days: readonly DayPlan[], style: PlanStyle): string {
  if (style === "balanced") return "締切に余裕を持って間に合わせつつ、毎日自由時間を残すプランです。";
  if (style === "relaxed") return "締切に間に合う範囲でゆっくり進め、休む時間とバッファを多めにとるプランです。";
  const ids = new Set(days.flatMap((day) => day.items).filter((item) => item.kind === "task" && item.task_id).map((item) => item.task_id!));
  const deadlines = context.tasks.filter((task) => ids.has(task.id) && task.deadline_at).sort((a, b) => a.id.localeCompare(b.id)).map((task) => task.title);
  const optional = context.tasks.filter((task) => ids.has(task.id) && classifyTask(task) === "optional").sort((a, b) => a.id.localeCompare(b.id)).map((task) => task.title);
  const extra = optional.length ? `、${[...new Set(optional)].join("と")}も進める` : "";
  return deadlines.length ? `締切のある${[...new Set(deadlines)].join("と")}を早めに終わらせ${extra}プランです。空き時間は少なめです。` : `目標の時間をしっかり確保し${extra}、空き時間は少なめのプランです。`;
}

function fatigueFit(context: PlanningContext, task: Task, date: string): number {
  if (date !== toDateStr(context.now) || context.checkin?.date !== date) return 1;
  if (context.checkin.fatigue === "high") return task.concentration === "high" ? 0 : task.concentration === "medium" ? 0.5 : 1;
  if (context.checkin.fatigue === "medium") return task.concentration === "high" ? 0.6 : 1;
  return 1;
}

export function addBufferSuggestions(context: PlanningContext, days: readonly DayPlan[], priorities: readonly TaskPriority[]): DayPlan[] {
  const order = new Map(priorities.map((entry, index) => [entry.task_id, index]));
  const light = context.tasks.filter((task) => !task.goal_id && task.status !== "completed" && task.estimated_minutes <= 30 && (task.buffer_fit === "high" || task.buffer_fit === "medium"));
  return days.map((day) => {
    const used = new Set<string>();
    return { date: day.date, items: day.items.map((item) => {
      if (item.kind !== "buffer") return item;
      const minutes = diffMinutesExact(item.start_at, item.end_at);
      const candidate = light.filter((task) => !used.has(task.id) && task.estimated_minutes <= minutes && (task.buffer_fit === "high" ? 1 : 0.6) * fatigueFit(context, task, day.date) >= 0.5).sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999) || a.id.localeCompare(b.id))[0];
      if (!candidate) return item;
      used.add(candidate.id);
      return { ...item, suggested_task_id: candidate.id };
    }) };
  });
}

export function addIntensiveLightTask(context: PlanningContext, days: readonly DayPlan[], priorities: readonly TaskPriority[]): DayPlan[] {
  const cloneDays = () => days.map((day) => ({ date: day.date, items: day.items.map((item) => ({ ...item })) }));
  const used = new Set(days.flatMap((day) => day.items).filter((item) => item.kind === "task" && item.task_id).map((item) => item.task_id!));
  const order = new Map(priorities.map((entry, index) => [entry.task_id, index]));
  const candidate = context.tasks.filter((task) => classifyTask(task) === "light" && !used.has(task.id)).sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999) || a.id.localeCompare(b.id))[0];
  if (!candidate) return cloneDays();
  const loads = days.map((day) => ({ day, minutes: day.items.filter((item) => item.kind === "task").reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0) }));
  if (!loads.every((entry) => entry.minutes < CONFIG.comfortableTaskMinutes)) return cloneDays();
  const target = loads.filter((entry) => entry.day.items.some((item) => item.kind === "free" && diffMinutesExact(item.start_at, item.end_at) >= 60)).sort((a, b) => (CONFIG.comfortableTaskMinutes - b.minutes) - (CONFIG.comfortableTaskMinutes - a.minutes) || a.day.date.localeCompare(b.day.date))[0];
  if (!target || target.minutes + candidate.estimated_minutes > context.preferences.daily_work_limit_minutes) return cloneDays();
  return days.map((day) => {
    if (day.date !== target.day.date) return structuredClone(day);
    const free = day.items.find((item) => item.kind === "free" && diffMinutesExact(item.start_at, item.end_at) >= 60)!;
    const end = addMinutes(free.start_at, candidate.estimated_minutes);
    const task: PlannedItem = { ...free, id: `${free.id}_light`, kind: "task", title: candidate.title, end_at: end, task_id: candidate.id, suggested_task_id: null, reason_code: null, reason: null };
    const rest = end < free.end_at ? { ...free, id: `${free.id}_rest`, start_at: end } : null;
    return { date: day.date, items: day.items.flatMap((item) => item.id === free.id ? [task, ...(rest ? [rest] : [])] : [item]).sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id)) };
  });
}

/** plans-replan.md 13.2 の再計画用テンプレート。 */
export function replanReason(
  code: Extract<ReasonCode, "REST" | "TIRED_LIGHT" | "TIRED_MOVED" | "GOAL_CARRYOVER" | "BUFFER_MERGED" | "FREE_EXTENDED" | "NEXT_WEEK">,
  values: { task?: Task; replacement?: Task; date?: string; context: PlanningContext },
): string {
  const task = values.task;
  const goal = task?.goal_id ? values.context.goals.find((entry) => entry.id === task.goal_id) : null;
  return formatReason(code, {
    deadlineAt: task?.deadline_at,
    goalHours: (goal ? values.context.goal_week_target_minutes[goal.id] ?? 0 : 0) / 60,
    taskName: task?.title,
    originalTaskName: task?.title,
    replacementTaskName: values.replacement?.title,
    date: values.date,
  });
}

export type ReplanSummaryOptions = {
  fixedEventEndWasAssumed?: boolean;
};

export function buildReplanSummary(
  context: PlanningContext,
  intent: ReplanProposal["intent"],
  changes: readonly ReplanChange[],
  otherChanges: readonly ReplanChange[],
  todayItems: readonly ScheduleItem[],
  options: ReplanSummaryOptions = {},
): string {
  const moved = otherChanges.map((change) => {
    const item = change.before ?? change.after[0];
    if (!item || !change.moved_to_date) return null;
    const task = item.task_id ? context.tasks.find((entry) => entry.id === item.task_id) : null;
    if (task?.goal_id) {
      const goal = context.goals.find((entry) => entry.id === task.goal_id);
      const replacement = changes.find((entry) => {
        const original = entry.before?.task_id ? context.tasks.find((candidate) => candidate.id === entry.before?.task_id) : null;
        return entry.change_type === "replaced" && original?.goal_id === task.goal_id;
      });
      const removedMinutes = replacement?.before ? diffMinutesExact(replacement.before.start_at, replacement.before.end_at) : 0;
      const lightMinutes = replacement?.after
        .filter((entry) => entry.kind === "task" && entry.task_id !== null && context.tasks.find((candidate) => candidate.id === entry.task_id)?.goal_id === task.goal_id)
        .reduce((sum, entry) => sum + diffMinutesExact(entry.start_at, entry.end_at), 0) ?? 0;
      const minutes = removedMinutes > lightMinutes
        ? removedMinutes - lightMinutes
        : change.after.filter((entry) => entry.kind === "task").reduce((sum, entry) => sum + diffMinutesExact(entry.start_at, entry.end_at), 0);
      const goalName = goal?.task_name.replace(/学習$/, "") ?? item.title;
      return `${goalName}の残り${minutes}分は${getWeekdayJa(change.moved_to_date)}曜`;
    }
    return `${item.title}は${getWeekdayJa(change.moved_to_date)}曜`;
  }).filter((value): value is string => value !== null);
  if (intent.type === "state_change") {
    const fixed = todayItems.filter((item) => item.kind === "fixed" && item.start_at >= context.now).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
    const goalHours = context.goals[0] ? (context.goal_week_target_minutes[context.goals[0].id] ?? 0) / 60 : 0;
    const deadline = context.tasks
      .filter((task) => task.deadline_at !== null)
      .sort((a, b) => a.deadline_at!.localeCompare(b.deadline_at!) || a.id.localeCompare(b.id))[0];
    const movedPart = moved.length ? `${[...new Set(moved)].join("、")}に回しました。` : "";
    const fixedPart = fixed ? `${fixed.title}はそのままで、` : "";
    return `お疲れさまです。今夜は軽めにして、${movedPart}${fixedPart}週${goalHours}時間の目標${deadline ? `と${deadline.title}の締切` : ""}も守れます。`;
  }
  if (intent.type === "new_fixed_event") {
    const fixed = [...intent.new_fixed_events].sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id))[0];
    const time = fixed?.start_at.slice(11, 16) ?? "時刻未定";
    const lead = moved.length ? `${time}からの予定を入れ、${[...new Set(moved)].join("、")}に移しました。` : `${time}からの予定を入れました。`;
    const assumed = options.fixedEventEndWasAssumed ? "終わりの時刻が分からないため、1時間で仮置きしました。" : "";
    return `${lead}${assumed}`;
  }
  if (intent.type === "task_change") {
    const descriptions = changes.map((change) => {
      const source = change.before ?? change.after[0];
      if (!source) return null;
      if (change.change_type === "shortened") {
        const minutes = change.after.filter((entry) => entry.kind === "task").reduce((sum, entry) => sum + diffMinutesExact(entry.start_at, entry.end_at), 0);
        return formatReason("USER_SHORTENED", { taskName: source.title, minutes });
      }
      if (change.change_type === "removed") return formatReason("USER_SKIPPED", { taskName: source.title });
      if (change.moved_to_date) return formatReason("USER_POSTPONED", { taskName: source.title, date: change.moved_to_date });
      return null;
    }).filter((value): value is string => value !== null);
    const changedTaskIds = new Set(changes.flatMap((change) => [change.before, ...change.after]).map((entry) => entry?.task_id).filter((value): value is string => value !== null && value !== undefined));
    const deadline = context.tasks.filter((task) => changedTaskIds.has(task.id) && task.deadline_at).sort((a, b) => a.deadline_at!.localeCompare(b.deadline_at!) || a.id.localeCompare(b.id))[0];
    return `${descriptions.join("、") || "タスクの予定を調整しました"}。${deadline ? `締切（${formatMonthDay(deadline.deadline_at!)}）には間に合います。` : ""}`;
  }
  return "ごめんなさい、この内容はまだ計画に反映できません。";
}
