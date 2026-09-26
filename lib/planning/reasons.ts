import { addMinutes, diffMinutesExact, formatMonthDay, toDateStr } from "@/lib/datetime";
import type { DayPlan, PlanStyle, PlannedItem, PlanningContext, ReasonCode, Task } from "@/lib/schemas";
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

function reasonFor(code: ReasonCode, task: Task, context: PlanningContext, item: PlannedItem): string {
  const deadline = task.deadline_at ? formatMonthDay(task.deadline_at) : "";
  const goal = context.goals.find((entry) => entry.id === task.goal_id);
  const hours = task.goal_id ? (context.goal_week_target_minutes[task.goal_id] ?? 0) / 60 : 0;
  switch (code) {
    case "DEADLINE_EARLY": return `締切（${deadline}）より早めに終わらせるため、${timeBandLabel(item.start_at)}に進めます`;
    case "DEADLINE_NEAR": return `締切（${deadline}）が近いため、ここで仕上げます`;
    case "DEADLINE_STEADY": return `締切（${deadline}）に向けて、少しずつ進めます`;
    case "GOAL_ROUTINE": return `週${hours}時間の${goal?.task_name ?? task.title}のため、${timeBandLabel(item.start_at)}に入れました`;
    case "OPTIONAL_EXTRA": return `時間に余裕があるため、${task.title}を進めます`;
    case "LIGHT_TASK": return `短い時間で終わる${task.title}を片付けます`;
    case "LIGHT_IN_BUFFER": return `短い時間でできる${task.title}を候補にしました`;
    default: return "";
  }
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
