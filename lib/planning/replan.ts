import { addDays, addMinutes, atJstTime, diffMinutesExact, toDateStr } from "@/lib/datetime";
import {
  EngineReplanResultSchema,
  PlannedItemSchema,
  PlanningContextSchema,
  ReplanningIntentSchema,
  type DayPlan,
  type EngineReplanResult,
  type PlannedItem,
  type PlanningContext,
  type ReplanProposal,
  type ScheduleItem,
  type Task,
} from "@/lib/schemas";
import { CONFIG } from "./config";
import { ReplanDiffBuilder } from "./diff";
import { classifyTask, computeTaskFit, isHighConcentrationTask } from "./fit";
import { buildReplanSummary, replanReason } from "./reasons";
import { validatePlan } from "./validate";

type Intent = ReplanProposal["intent"];
type MoveReason = "TIRED_MOVED" | "GOAL_CARRYOVER" | "USER_POSTPONED";
type PlannedDay = { date: string; items: PlannedItem[] };

const compare = (a: ScheduleItem, b: ScheduleItem) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id);
const duration = (item: ScheduleItem) => diffMinutesExact(item.start_at, item.end_at);
const overlaps = (a: Pick<ScheduleItem, "start_at" | "end_at">, b: Pick<ScheduleItem, "start_at" | "end_at">) => a.start_at < b.end_at && b.start_at < a.end_at;

function fail(reason: string, changes: string[] = ["予定を調整する"]): EngineReplanResult {
  return EngineReplanResultSchema.parse({ ok: false, infeasible: { feasible: false, reason, required_changes: changes } });
}

function withReason(item: ScheduleItem, reason_code: PlannedItem["reason_code"], reason: string | null): PlannedItem {
  return { ...item, reason_code, reason };
}

/** DayPlan(API) と reason_code 付き内部項目の境界を PlannedItem にそろえる。 */
function normalizeBeforeItem(item: ScheduleItem & { reason_code?: unknown }): PlannedItem {
  return PlannedItemSchema.parse({
    ...item,
    location_id: item.location_id ?? null,
    task_id: item.task_id ?? null,
    fixed_event_id: item.fixed_event_id ?? null,
    fixed_category: item.fixed_category ?? null,
    travel: item.travel ?? null,
    suggested_task_id: item.suggested_task_id ?? null,
    reason: item.reason ?? null,
    reason_code: item.reason_code ?? null,
  });
}

function normalizeBefore(days: readonly DayPlan[], now: string): PlannedDay[] {
  return days.map((day) => ({ date: day.date, items: day.items.map((rawItem) => {
    const item = normalizeBeforeItem(rawItem);
    if (item.end_at <= now) return { ...item, locked: true, status: item.kind === "task" ? "completed" as const : item.status };
    if (item.start_at < now && item.end_at > now) {
      if (["task", "fixed", "travel", "sleep"].includes(item.kind)) return { ...item, locked: true };
      if (["free", "buffer"].includes(item.kind)) return { ...item, locked: false };
    }
    return { ...item };
  }).sort(compare) }));
}

function stableIds(days: PlannedDay[], style: string): PlannedDay[] {
  return days.map((day) => {
    let sequence = 0;
    return { date: day.date, items: day.items.sort(compare).map((item) => item.id.startsWith("replan_") ? { ...item, id: `tmp_${style}_${day.date}_r${String(++sequence).padStart(3, "0")}` } : item) };
  });
}

function planned(template: ScheduleItem, kind: ScheduleItem["kind"], start: string, end: string, title: string, taskId: string | null = null): PlannedItem {
  return { ...template, id: `replan_${kind}_${start}`, kind, title, start_at: start, end_at: end, task_id: taskId, fixed_event_id: null, fixed_category: null, travel: null, suggested_task_id: null, locked: false, status: "planned", reason_code: null, reason: null };
}

function gaps(date: string, now: string, kept: readonly ScheduleItem[], home: string): Array<{ start: string; end: string; location_id: string }> {
  const end = atJstTime(date, "24:00");
  const sorted = kept.filter((item) => item.end_at > now && item.start_at < end).sort(compare);
  const result: Array<{ start: string; end: string; location_id: string }> = [];
  let cursor = now;
  let location = home;
  for (const item of sorted) {
    if (cursor < item.start_at) result.push({ start: cursor, end: item.start_at, location_id: location });
    if (item.end_at > cursor) cursor = item.end_at;
    location = item.travel?.to_location_id ?? item.location_id ?? location;
  }
  if (cursor < end) result.push({ start: cursor, end, location_id: location });
  return result.filter((gap) => duration({ start_at: gap.start, end_at: gap.end } as ScheduleItem) > 0);
}

function taskLoad(day: DayPlan): number {
  return day.items.filter((item) => item.kind === "task").reduce((sum, item) => sum + duration(item), 0);
}

function workEnd(context: PlanningContext, date: string, end: string): string {
  const cutoff = addMinutes(atJstTime(date, context.preferences.sleep_start === "00:00" ? "24:00" : context.preferences.sleep_start), -30);
  return end < cutoff ? end : cutoff;
}

function insertIntoFree(
  context: PlanningContext,
  day: DayPlan,
  task: Task,
  minutes: number,
  minimumFreeMinutes = 0,
): PlannedItem[] | null {
  const limit = toDateStr(task.deadline_at ?? addDays(day.date, 1)) === addDays(day.date, 1)
    ? context.preferences.daily_work_limit_minutes : CONFIG.comfortableTaskMinutes;
  if (taskLoad(day) + minutes > limit) return null;
  for (const free of day.items.filter((item) => item.kind === "free").sort(compare)) {
    if (duration(free) < minimumFreeMinutes) continue;
    const end = addMinutes(free.start_at, minutes);
    const bufferEnd = addMinutes(end, CONFIG.replan.buffer_minutes);
    const slotEnd = workEnd(context, day.date, free.end_at);
    if (bufferEnd > slotEnd) continue;
    const fitContext = { ...context, checkin: null };
    const fit = computeTaskFit({ context: fitContext, task, slot: { start: free.start_at, end: free.end_at, work_end: slotEnd, location_id: free.location_id ?? context.home_location_id }, start: free.start_at, minutes, band: null });
    if (fit.fit <= 0) continue;
    const taskItem = planned(free, "task", free.start_at, end, task.title, task.id);
    const buffer = planned(free, "buffer", end, bufferEnd, "バッファ");
    const rest = bufferEnd < free.end_at ? planned(free, "free", bufferEnd, free.end_at, "自由時間") : null;
    day.items = day.items.flatMap((item) => item.id === free.id ? [taskItem, buffer, ...(rest ? [rest] : [])] : [item]).sort(compare);
    return [taskItem, buffer];
  }
  return null;
}

function extendGoal(day: DayPlan, task: Task, minutes: number): PlannedItem[] | null {
  const sorted = day.items.sort(compare);
  for (let index = 0; index < sorted.length - 2; index++) {
    const current = sorted[index]; const buffer = sorted[index + 1]; const free = sorted[index + 2];
    if (current.kind !== "task" || current.task_id !== task.id || buffer.kind !== "buffer" || free.kind !== "free") continue;
    if (duration(free) < minutes) continue;
    const extended = withReason({ ...current, end_at: addMinutes(current.end_at, minutes) }, null, current.reason);
    const movedBuffer = withReason({ ...buffer, start_at: extended.end_at, end_at: addMinutes(buffer.end_at, minutes) }, null, buffer.reason);
    const rest = { ...free, start_at: movedBuffer.end_at };
    day.items = [...sorted.slice(0, index), extended, movedBuffer, ...(rest.start_at < rest.end_at ? [rest] : []), ...sorted.slice(index + 3)].sort(compare);
    return [extended, movedBuffer];
  }
  return null;
}

function moveFuture(
  context: PlanningContext,
  days: DayPlan[],
  task: Task,
  minutes: number,
  before: ScheduleItem,
  reasonCode: MoveReason,
  diff: ReplanDiffBuilder,
): { placed: PlannedItem[]; date: string } | null {
  const today = toDateStr(context.now);
  const sunday = addDays(context.week_start, 6);
  const candidates = days.filter((day) => day.date > today && day.date <= sunday);
  const ordered = classifyTask(task) === "deadline"
    ? candidates.filter((day) => !task.deadline_at || day.date <= addDays(toDateStr(task.deadline_at), -1)).sort((a, b) => a.date.localeCompare(b.date))
    : candidates.sort((a, b) => b.items.filter((item) => item.kind === "free").reduce((sum, item) => sum + duration(item), 0) - a.items.filter((item) => item.kind === "free").reduce((sum, item) => sum + duration(item), 0) || a.date.localeCompare(b.date));
  for (const day of ordered) {
    const placed = classifyTask(task) === "goal" ? extendGoal(day, task, minutes) ?? insertIntoFree(context, day, task, minutes) : insertIntoFree(context, day, task, minutes);
    if (!placed) continue;
    const reason = replanReason(reasonCode, { context, task, date: day.date });
    placed[0] = withReason(placed[0], reasonCode, reason);
    day.items = day.items.map((item) => item.id === placed[0].id ? placed[0] : item);
    diff.record("other", { change_type: "moved", before, after: placed, moved_to_date: day.date, reason });
    return { placed, date: day.date };
  }
  return null;
}

function findTask(context: PlanningContext, id: string | null): Task | null {
  return id ? context.tasks.find((task) => task.id === id) ?? null : null;
}

function resolveRecordedItems(changes: ReturnType<ReplanDiffBuilder["build"]>, days: readonly DayPlan[]): ReturnType<ReplanDiffBuilder["build"]> {
  const items = days.flatMap((day) => day.items);
  const resolve = (item: ScheduleItem) => items.find((candidate) => candidate.kind === item.kind && candidate.start_at === item.start_at && candidate.end_at === item.end_at && candidate.task_id === item.task_id && candidate.title === item.title) ?? item;
  return {
    changes: changes.changes.map((change) => ({ ...change, after: change.after.map(resolve) })),
    other_day_changes: changes.other_day_changes.map((change) => ({ ...change, after: change.after.map(resolve) })),
  };
}

function mergeAdjacentFree(items: readonly PlannedItem[]): PlannedItem[] {
  const result: PlannedItem[] = [];
  for (const item of [...items].sort(compare)) {
    const previous = result[result.length - 1];
    if (previous?.kind === "free" && item.kind === "free" && previous.end_at === item.start_at && previous.location_id === item.location_id) {
      result[result.length - 1] = { ...previous, end_at: item.end_at, reason: null, reason_code: null };
    } else {
      result.push(item);
    }
  }
  return result;
}

function replanNewFixedEvent(
  context: PlanningContext,
  days: PlannedDay[],
  intent: Intent & { type: "new_fixed_event" },
): EngineReplanResult {
  const today = toDateStr(context.now);
  const events = [...intent.new_fixed_events].sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id));
  if (events.length !== 1) return fail("追加する予定を1件指定してください。", []);
  const event = events[0];
  if (toDateStr(event.start_at) !== today || toDateStr(addMinutes(event.end_at, -1)) !== today || event.start_at < context.now || event.start_at >= event.end_at) {
    return fail("今日のこれからの時間に入る予定を指定してください。", []);
  }
  const todayDay = days.find((day) => day.date === today);
  if (!todayDay) return fail("今日の計画がありません。");
  const beforeSnapshot = structuredClone(days);
  const originalToday = structuredClone(todayDay);
  const conflicts = originalToday.items.filter((item) => overlaps(item, event));
  const protectedConflict = conflicts.find((item) => item.locked || item.status === "completed" || ["sleep", "fixed", "travel"].includes(item.kind));
  if (protectedConflict) return fail(`${protectedConflict.title}と重なるため、予定を追加できません。`, ["予定の時刻を調整する"]);

  const diff = new ReplanDiffBuilder();
  const reason = replanReason("FIXED_EVENT_ADDED", { context, time: event.start_at.slice(11, 16) });
  const fixedItem = PlannedItemSchema.parse({
    id: event.id,
    kind: "fixed",
    title: event.title,
    start_at: event.start_at,
    end_at: event.end_at,
    location_id: event.location_id,
    task_id: null,
    fixed_event_id: event.id,
    fixed_category: event.category,
    travel: null,
    suggested_task_id: null,
    locked: true,
    status: "planned",
    reason,
    reason_code: "FIXED_EVENT_ADDED",
  });
  diff.record("today", { change_type: "added", before: null, after: [fixedItem], reason });

  const removedTasks: Array<{ item: PlannedItem; task: Task }> = [];
  const removedIds = new Set(conflicts.map((item) => item.id));
  const sortedOriginal = [...originalToday.items].sort(compare);
  for (let index = 0; index < sortedOriginal.length; index++) {
    const item = sortedOriginal[index];
    if (item.kind !== "task" || !removedIds.has(item.id)) continue;
    const task = findTask(context, item.task_id);
    if (task) removedTasks.push({ item, task });
    const following = sortedOriginal[index + 1];
    if (following?.kind === "buffer" && !following.locked && following.start_at === item.end_at) removedIds.add(following.id);
  }

  const rebuilt: PlannedItem[] = [];
  let generatedFree = 0;
  const addFree = (template: PlannedItem, start: string, end: string): PlannedItem | null => {
    if (start >= end) return null;
    const free = withReason({
      ...template,
      id: `replan_free_fixed_${today}_${String(++generatedFree).padStart(3, "0")}`,
      kind: "free",
      title: "自由時間",
      start_at: start,
      end_at: end,
      task_id: null,
      fixed_event_id: null,
      fixed_category: null,
      travel: null,
      suggested_task_id: null,
      locked: false,
      status: "planned",
    }, null, null);
    rebuilt.push(free);
    return free;
  };
  for (const item of sortedOriginal) {
    if (!removedIds.has(item.id)) {
      rebuilt.push(item);
      continue;
    }
    if (item.kind === "task") {
      addFree(item, item.start_at, item.start_at < event.start_at ? event.start_at < item.end_at ? event.start_at : item.end_at : item.start_at);
      addFree(item, item.end_at > event.end_at ? item.start_at > event.end_at ? item.start_at : event.end_at : item.end_at, item.end_at);
      continue;
    }
    if (item.kind === "free" || item.kind === "buffer") {
      const fragments = [
        addFree(item, item.start_at, item.start_at < event.start_at ? event.start_at < item.end_at ? event.start_at : item.end_at : item.start_at),
        addFree(item, item.end_at > event.end_at ? item.start_at > event.end_at ? item.start_at : event.end_at : item.end_at, item.end_at),
      ].filter((value): value is PlannedItem => value !== null);
      if (item.kind === "buffer") diff.record("today", { change_type: "removed", before: item, reason: replanReason("BUFFER_MERGED", { context }) });
      else diff.record("today", { change_type: "replaced", before: item, after: fragments, reason: replanReason("FREE_EXTENDED", { context }) });
    }
  }
  rebuilt.push(fixedItem);
  todayDay.items = mergeAdjacentFree(rebuilt);

  for (const entry of removedTasks) {
    const minutes = duration(entry.item);
    const placedToday = insertIntoFree(context, todayDay, entry.task, minutes, 60);
    if (placedToday) {
      const movedReason = replanReason("USER_POSTPONED", { context, task: entry.task, date: today });
      placedToday[0] = withReason(placedToday[0], "USER_POSTPONED", movedReason);
      todayDay.items = todayDay.items.map((item) => item.id === placedToday[0].id ? placedToday[0] : item).sort(compare);
      diff.record("today", { change_type: "moved", before: entry.item, after: placedToday, moved_to_date: today, reason: movedReason });
      continue;
    }
    const moveReason: MoveReason = entry.task.goal_id ? "GOAL_CARRYOVER" : "USER_POSTPONED";
    const moved = moveFuture(context, days, entry.task, minutes, entry.item, moveReason, diff);
    if (!moved) return fail(entry.task.goal_id ? "今週の目標時間を置く空き時間が足りません。" : `${entry.task.title}を移せる空き時間がありません。`, [`${entry.task.title}の予定を調整する`]);
    diff.record("today", { change_type: "moved", before: entry.item, after: [], moved_to_date: moved.date, reason: replanReason(moveReason, { context, task: entry.task, date: moved.date }) });
  }

  const finalDays = stableIds(days, context.style!);
  const validationContext = { ...context, fixed_events: [...context.fixed_events, event] };
  const validation = validatePlan(validationContext, finalDays, "replan", { before: beforeSnapshot });
  if (validation.errors.length) return fail(`再計画後の検証に失敗しました：${validation.errors[0].message}`);
  const changes = resolveRecordedItems(diff.build(), finalDays);
  const finalToday = finalDays.find((day) => day.date === today)!;
  const summary = buildReplanSummary(context, intent, changes.changes, changes.other_day_changes, finalToday.items);
  const proposal = { date: today, intent, before: beforeSnapshot.find((day) => day.date === today)!, after: finalToday, ...changes, summary_message: summary };
  const updated = finalDays.filter((day) => day.date === today || changes.other_day_changes.some((change) => change.moved_to_date === day.date));
  return EngineReplanResultSchema.parse({ ok: true, proposal, updated_days: updated });
}

function taskChangeFailure(message: string): EngineReplanResult {
  return fail(message, []);
}

function replanTaskChange(
  context: PlanningContext,
  days: PlannedDay[],
  intent: Intent & { type: "task_change" },
): EngineReplanResult {
  const today = toDateStr(context.now);
  const todayDay = days.find((day) => day.date === today);
  if (!todayDay) return fail("今日の計画がありません。");
  if (intent.task_changes.length === 0) return taskChangeFailure("変更するタスクを指定してください。");

  const actionsByTask = new Map<string, Set<string>>();
  for (const change of intent.task_changes) {
    const actions = actionsByTask.get(change.task_id) ?? new Set<string>();
    actions.add(change.action);
    actionsByTask.set(change.task_id, actions);
  }
  const conflict = [...actionsByTask.entries()].find(([, actions]) => actions.size > 1);
  if (conflict) return taskChangeFailure("同じタスクに複数の変更が指定されています。変更内容を1つにしてください。");

  const normalizedChanges = [...actionsByTask.entries()]
    .map(([task_id, actions]) => ({ task_id, action: [...actions][0] as "postpone" | "skip" | "shorten" }))
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
  for (const change of normalizedChanges) {
    const task = findTask(context, change.task_id);
    if (!task) return taskChangeFailure("指定されたタスクが見つかりません。");
    const hasAnyToday = todayDay.items.some((item) => item.kind === "task" && item.task_id === task.id);
    if (!hasAnyToday) return taskChangeFailure(`${task.title}は今日の計画にありません。`);
    const modifiable = todayDay.items.some((item) => item.kind === "task" && item.task_id === task.id && item.start_at >= context.now && !item.locked && item.status !== "completed");
    if (!modifiable) return taskChangeFailure(`${task.title}には変更できる今後の予定がありません。`);
  }

  const beforeSnapshot = structuredClone(days);
  const diff = new ReplanDiffBuilder();
  const orderedTargets = normalizedChanges.flatMap((change) => todayDay.items
    .filter((item) => item.kind === "task" && item.task_id === change.task_id && item.start_at >= context.now && !item.locked && item.status !== "completed")
    .map((item) => ({ change, item })))
    .sort((a, b) => compare(a.item, b.item));

  for (const { change, item: source } of orderedTargets) {
    const task = findTask(context, change.task_id)!;
    const currentIndex = todayDay.items.findIndex((item) => item.id === source.id);
    if (currentIndex < 0) continue;
    const current = todayDay.items[currentIndex] as PlannedItem;
    const following = todayDay.items[currentIndex + 1] as PlannedItem | undefined;
    const followingBuffer = following?.kind === "buffer" && !following.locked && following.start_at === current.end_at ? following : null;
    const originalMinutes = duration(current);
    const shortenedMinutes = change.action === "shorten" ? Math.floor((originalMinutes / 2) / 5) * 5 : 0;
    const keptMinutes = change.action === "shorten" && shortenedMinutes >= 30 ? shortenedMinutes : 0;
    const remainingMinutes = originalMinutes - keptMinutes;
    const sourceEnd = followingBuffer?.end_at ?? current.end_at;
    const sourceItems = new Set([current.id, ...(followingBuffer ? [followingBuffer.id] : [])]);
    todayDay.items = todayDay.items.filter((item) => !sourceItems.has(item.id));

    let shortened: PlannedItem | null = null;
    if (keptMinutes > 0) {
      const shortenedEnd = addMinutes(current.start_at, keptMinutes);
      const shortenReason = replanReason("USER_SHORTENED", { context, task, minutes: keptMinutes });
      shortened = withReason({ ...current, end_at: shortenedEnd }, "USER_SHORTENED", shortenReason);
      const bufferEnd = addMinutes(shortenedEnd, CONFIG.replan.buffer_minutes);
      const buffer = planned(current, "buffer", shortenedEnd, bufferEnd, "バッファ");
      todayDay.items.push(shortened, buffer);
      if (bufferEnd < sourceEnd) todayDay.items.push(planned(current, "free", bufferEnd, sourceEnd, "自由時間"));
      diff.record("today", { change_type: "shortened", before: current, after: [shortened], reason: shortenReason });
    } else {
      todayDay.items.push(planned(current, "free", current.start_at, sourceEnd, "自由時間"));
      if (change.action === "shorten") {
        const shortenReason = replanReason("USER_SHORTENED", { context, task, minutes: 0 });
        diff.record("today", { change_type: "shortened", before: current, after: [], reason: shortenReason });
      }
    }
    if (followingBuffer) diff.record("today", { change_type: "removed", before: followingBuffer, reason: replanReason("BUFFER_MERGED", { context }) });
    todayDay.items = mergeAdjacentFree(todayDay.items as PlannedItem[]);

    const kind = classifyTask(task);
    const optional = kind === "optional" || kind === "light";
    const skipOptional = change.action === "skip" && optional;
    if (skipOptional) {
      const skippedReason = replanReason("USER_SKIPPED", { context, task });
      diff.record("today", { change_type: "removed", before: current, reason: skippedReason });
      continue;
    }

    if (task.deadline_at && toDateStr(task.deadline_at) > addDays(context.week_start, 6)) {
      const nextWeekReason = replanReason("NEXT_WEEK", { context, task });
      diff.record("today", { change_type: "removed", before: current, reason: nextWeekReason });
      continue;
    }

    const moveReason: MoveReason = kind === "goal" ? "GOAL_CARRYOVER" : "USER_POSTPONED";
    const moved = moveFuture(context, days, task, remainingMinutes, current, moveReason, diff);
    if (!moved) {
      if (optional) {
        const skippedReason = replanReason("USER_SKIPPED", { context, task });
        diff.record("today", { change_type: "removed", before: current, reason: skippedReason });
        continue;
      }
      return fail(kind === "goal" ? "今週の目標時間を置く空き時間が足りません。" : `${task.title}を締切までに移せる空き時間がありません。`, [`${task.title}の予定を調整する`]);
    }
    const todayReason = replanReason("USER_POSTPONED", { context, task, date: moved.date });
    if (change.action !== "shorten") diff.record("today", { change_type: "moved", before: current, after: [], moved_to_date: moved.date, reason: todayReason });
  }

  const finalDays = stableIds(days, context.style!);
  const validation = validatePlan(context, finalDays, "replan", { before: beforeSnapshot });
  if (validation.errors.length) return fail(`再計画後の検証に失敗しました：${validation.errors[0].message}`);
  const changes = resolveRecordedItems(diff.build(), finalDays);
  const finalToday = finalDays.find((day) => day.date === today)!;
  const summary = buildReplanSummary(context, intent, changes.changes, changes.other_day_changes, finalToday.items);
  const proposal = { date: today, intent, before: beforeSnapshot.find((day) => day.date === today)!, after: finalToday, ...changes, summary_message: summary };
  const updated = finalDays.filter((day) => day.date === today || changes.other_day_changes.some((entry) => entry.moved_to_date === day.date));
  return EngineReplanResultSchema.parse({ ok: true, proposal, updated_days: updated });
}

/** plans-replan.md 12.4: 今日を直接作り直し、必要分だけ明日以降へ移す。 */
export function replan(inputContext: PlanningContext, inputDays: readonly DayPlan[], inputIntent: Intent): EngineReplanResult {
  const context = PlanningContextSchema.parse(structuredClone(inputContext));
  const intent = ReplanningIntentSchema.parse(structuredClone(inputIntent));
  if (context.style === null) return fail("先にプランを選んでください。");
  const days = normalizeBefore(structuredClone(inputDays), context.now);
  if (intent.type === "new_fixed_event") return replanNewFixedEvent(context, days, intent as Intent & { type: "new_fixed_event" });
  if (intent.type === "task_change") return replanTaskChange(context, days, intent as Intent & { type: "task_change" });
  if ((intent.type as string) !== "state_change") {
    return fail("ごめんなさい、この内容はまだ計画に反映できません。『今日は疲れた』『20時から1時間予定が入った』『今日はもう勉強したくない』のように教えてください。", []);
  }
  if (intent.type === "state_change" && intent.fatigue !== "high" && intent.fatigue !== "medium") return fail("変更したい内容をもう少し具体的に教えてください。");
  const beforeSnapshot = structuredClone(days);
  const today = toDateStr(context.now);
  const todayDay = days.find((day) => day.date === today);
  if (!todayDay) return fail("今日の計画がありません。");
  const diff = new ReplanDiffBuilder();
  const removed: Array<{ item: ScheduleItem; task: Task; minutes: number; reason: MoveReason; splitInProgress: boolean }> = [];
  const originalToday = structuredClone(todayDay);

  const affected = new Set<string>();

  if (intent.type === "state_change") {
    const fatigueContext = { ...context, checkin: { date: today, mood: null, fatigue: "high" as const, concentration: null, want_task_ids: [], avoid_task_ids: [], note: null } };
    for (const item of todayDay.items) {
      const task = findTask(context, item.task_id);
      if (!task || item.kind !== "task" || item.end_at <= context.now || item.status === "completed") continue;
      if (!isHighConcentrationTask(task)) continue;
      const crossesNow = item.start_at < context.now && context.now < item.end_at;
      if (item.locked && !crossesNow) continue;
      const fitStart = crossesNow ? context.now : item.start_at;
      const fitMinutes = diffMinutesExact(fitStart, item.end_at);
      const end = workEnd(context, today, atJstTime(today, "24:00"));
      const fit = computeTaskFit({ context: fatigueContext, task, slot: { start: fitStart, end, work_end: end, location_id: item.location_id ?? context.home_location_id }, start: fitStart, minutes: fitMinutes, band: null });
      if (fit.fit === 0) affected.add(item.id);
    }
  }

  const affectedTaskIds = new Set(affected);
  const requiredBufferIds = new Set<string>();
  const sortedToday = [...todayDay.items].sort(compare);
  for (let index = 0; index < sortedToday.length; index++) {
    const item = sortedToday[index];
    if (item.kind !== "buffer" || item.end_at <= context.now || item.locked) continue;
    const previous = sortedToday[index - 1];
    const next = sortedToday[index + 1];
    const followsAffected = previous?.kind === "task" && affectedTaskIds.has(previous.id) && previous.end_at === item.start_at;
    if (followsAffected) {
      affected.add(item.id);
      diff.record("today", {
        change_type: "removed",
        before: item,
        reason: replanReason("BUFFER_MERGED", { context }),
      });
      continue;
    }
    const touchesKeptTask =
      (previous?.kind === "task" && !affectedTaskIds.has(previous.id) && previous.end_at === item.start_at) ||
      (next?.kind === "task" && !affectedTaskIds.has(next.id) && item.end_at === next.start_at);
    if (touchesKeptTask) requiredBufferIds.add(item.id);
  }

  const removedItems = todayDay.items.filter((item) => affected.has(item.id));
  const taskPrefixes: PlannedItem[] = [];
  for (const item of removedItems) {
    if (item.kind !== "task") continue;
    const task = findTask(context, item.task_id); if (!task) continue;
    const movable = item.start_at < context.now
      ? { ...item, id: `${item.id}_after_now`, start_at: context.now }
      : item;
    if (item.start_at < context.now) taskPrefixes.push({ ...item, end_at: context.now, locked: true, status: "completed" });
    removed.push({ item, task, minutes: duration(movable), reason: task.goal_id ? "GOAL_CARRYOVER" : "TIRED_MOVED", splitInProgress: item.start_at < context.now && context.now < item.end_at });
  }

  const kept = todayDay.items.filter((item) => {
    if (affected.has(item.id)) return false;
    return !(item.kind === "free" || item.kind === "buffer") || item.end_at <= context.now || item.locked || (requiredBufferIds.has(item.id) && item.start_at >= context.now);
  });
  const prefix: PlannedItem[] = [];
  for (const item of originalToday.items.filter((entry) => (entry.kind === "free" || entry.kind === "buffer") && entry.start_at < context.now && entry.end_at > context.now)) prefix.push({ ...item, end_at: context.now, locked: true });
  const fixedKept = [...kept.filter((item) => item.end_at <= context.now || !["free", "buffer"].includes(item.kind) || requiredBufferIds.has(item.id)), ...prefix, ...taskPrefixes].sort(compare);
  const freeGaps = gaps(today, context.now, fixedKept, context.home_location_id);
  const rebuilt: PlannedItem[] = [...fixedKept];
  const replacement: PlannedItem[] = [];

  if (intent.type === "state_change") {
    const first = freeGaps.find((gap) => diffMinutesExact(gap.start, workEnd(context, today, gap.end)) >= CONFIG.replan.tired_rest_minutes);
    if (first) {
      const template = originalToday.items.find((item) => item.kind === "free" && overlaps(item, { start_at: first.start, end_at: first.end })) ?? originalToday.items[0];
      const restEnd = addMinutes(first.start, CONFIG.replan.tired_rest_minutes);
      const rest = withReason(planned({ ...template, location_id: first.location_id }, "free", first.start, restEnd, "休憩"), "REST", replanReason("REST", { context }));
      rebuilt.push(rest); replacement.push(rest); first.start = restEnd;
      const removedGoal = removed.find((entry) => entry.task.goal_id);
      if (removedGoal) {
        const light = context.tasks.filter((task) => task.goal_id === removedGoal.task.goal_id).sort((a, b) => a.estimated_minutes - b.estimated_minutes || a.id.localeCompare(b.id))[0];
        const available = diffMinutesExact(first.start, workEnd(context, today, first.end)) - CONFIG.replan.tired_light_buffer_min_minutes;
        const lightMinutes = Math.floor(Math.min(removedGoal.minutes, CONFIG.replan.tired_light_max_minutes, available) / 5) * 5;
        if (light && lightMinutes >= CONFIG.replan.tired_light_min_minutes) {
          const lightEnd = addMinutes(first.start, lightMinutes);
          const bufferEnd = addMinutes(lightEnd, CONFIG.replan.tired_light_buffer_min_minutes);
          const lightItem = withReason(planned(template, "task", first.start, lightEnd, light.title, light.id), "TIRED_LIGHT", replanReason("TIRED_LIGHT", { context, task: removedGoal.task, replacement: light }));
          const buffer = planned(template, "buffer", lightEnd, bufferEnd, "バッファ");
          rebuilt.push(lightItem, buffer); replacement.push(lightItem, buffer); first.start = bufferEnd;
          removedGoal.minutes -= lightMinutes;
        }
      }
    }
  }
  for (const gap of freeGaps) if (gap.start < gap.end) rebuilt.push(planned({ ...(originalToday.items[0]), location_id: gap.location_id }, "free", gap.start, gap.end, "自由時間"));
  todayDay.items = rebuilt.filter((item) => item.start_at < item.end_at).sort(compare);

  for (const crossing of originalToday.items.filter((item) => (item.kind === "free" || item.kind === "buffer") && item.start_at < context.now && item.end_at > context.now)) {
    const after = todayDay.items.filter((item) => item.start_at < crossing.end_at && crossing.start_at < item.end_at);
    diff.record("today", {
      change_type: "replaced",
      before: crossing,
      after,
      reason: after.some((item) => "reason_code" in item && item.reason_code === "REST")
        ? replanReason("REST", { context })
        : replanReason("FREE_EXTENDED", { context }),
    });
  }

  if (intent.type === "state_change") {
    const splitRemoved = removed.find((entry) => entry.splitInProgress);
    if (splitRemoved) {
      const prefixItem = taskPrefixes.find((item) => item.id === splitRemoved.item.id);
      diff.record("today", {
        change_type: "replaced",
        before: splitRemoved.item,
        after: [...(prefixItem ? [prefixItem] : []), ...replacement],
        reason: replacement.find((item) => item.reason_code === "TIRED_LIGHT")?.reason ?? replanReason("REST", { context }),
      });
    }
    const goalRemoved = removed.find((entry) => entry.task.goal_id);
    if (goalRemoved) diff.record("today", { change_type: "replaced", before: goalRemoved.item, after: replacement, reason: replacement.find((item) => item.reason_code === "TIRED_LIGHT")?.reason ?? replanReason("REST", { context }) });
  }
  for (const entry of removed.filter((value) => value.minutes > 0)) {
    if (!entry.splitInProgress && entry.task.deadline_at && toDateStr(entry.task.deadline_at) > addDays(context.week_start, 6)) {
      const reason = replanReason("NEXT_WEEK", { context, task: entry.task });
      diff.record("today", { change_type: "removed", before: entry.item, reason });
      continue;
    }
    if (!moveFuture(context, days, entry.task, entry.minutes, entry.item, entry.reason, diff)) return fail(entry.task.goal_id ? `今週の目標時間を置く空き時間が足りません。` : `${entry.task.title}を移せる空き時間がありません。`, [`${entry.task.title}の予定を調整する`]);
  }

  const finalDays = stableIds(days, context.style);
  const validation = validatePlan(context, finalDays, "replan", {
    before: beforeSnapshot,
    allowedInProgressTaskSplitIds: removed.filter((entry) => entry.splitInProgress).map((entry) => entry.item.id),
  });
  if (validation.errors.length) return fail(`再計画後の検証に失敗しました：${validation.errors[0].message}`);
  const changes = resolveRecordedItems(diff.build(), finalDays);
  const finalToday = finalDays.find((day) => day.date === today)!;
  const summary = buildReplanSummary(context, intent, changes.changes, changes.other_day_changes, finalToday.items);
  const proposal = { date: today, intent, before: beforeSnapshot.find((day) => day.date === today)!, after: finalToday, ...changes, summary_message: summary };
  const updated = finalDays.filter((day) => day.date === today || changes.other_day_changes.some((change) => change.moved_to_date === day.date));
  return EngineReplanResultSchema.parse({ ok: true, proposal, updated_days: updated });
}
