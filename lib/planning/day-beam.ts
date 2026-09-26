import { addDays, addMinutes, atJstTime, ceilToMinutes, diffMinutesExact, toDateStr } from "@/lib/datetime";
import type { DayPlan, PlannedItem, PlanningContext, ScheduleItem, Task, TimeBand } from "@/lib/schemas";
import type { AllocationQuota, WeeklyAllocation } from "./allocate";
import { CONFIG } from "./config";
import { computeTaskFit } from "./fit";
import type { TaskPriority } from "./priority";
import { computeTaskPriorities } from "./priority";
import { buildSkeleton } from "./skeleton";
import { buildFreeSlots, type FreeSlot } from "./slots";

export type BeamWeights = readonly [number, number, number, number, number, number];
export type BeamLast = "start" | "task" | "buffer" | "free";

export type QuotaRemaining = {
  quota_key: string;
  quota: AllocationQuota;
  initial_minutes: number;
  remaining_minutes: number;
};

export type BeamEvaluation = {
  achievement: number;
  fit: number;
  deadline_safety: number;
  buffer: number;
  free_time: number;
  over: number;
  penalty: number;
  score: number;
};

export type DayBeamInput = {
  date: string;
  slots: readonly FreeSlot[];
  quotas: readonly AllocationQuota[];
  weights: BeamWeights;
  context: PlanningContext;
  existing_items: readonly ScheduleItem[];
  priorities?: readonly TaskPriority[];
  /** 例: intensive。最終style別IDへの変換前の決定論的な仮IDに使う。 */
  id_prefix: string;
  buffer_options?: readonly number[];
};

export type DayBeamResult = {
  ok: true;
  date: string;
  items: PlannedItem[];
  remaining: QuotaRemaining[];
  dayTaskMinutes: number;
  evaluation: BeamEvaluation;
  steps: number;
  forced_close: boolean;
  required_complete: boolean;
  max_beam_size: number;
  deduplicated_states: number;
};

type BeamState = {
  gapIndex: number;
  cursor: string;
  last: BeamLast;
  hasTaskInGap: boolean;
  remaining: number[];
  dayTaskMinutes: number;
  items: PlannedItem[];
  done: boolean;
  fitMinuteSum: number;
  placedTaskMinutes: number;
};

type NormalizedQuota = { key: string; quota: AllocationQuota };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function quotaSortKey(quota: AllocationQuota): string {
  return [quota.kind, quota.task_id, quota.minutes, quota.band ?? "", quota.deadline_at ?? "", quota.completion_target_date ?? ""].join("|");
}

function normalizeQuotas(quotas: readonly AllocationQuota[]): NormalizedQuota[] {
  return quotas
    .map((quota, inputIndex) => ({ quota: structuredClone(quota), inputIndex, sort: quotaSortKey(quota) }))
    .sort((a, b) => compareText(a.sort, b.sort) || a.inputIndex - b.inputIndex)
    .map(({ quota, sort }, index) => ({ key: `${sort}|${index}`, quota }));
}

function makeItem(
  input: DayBeamInput,
  state: BeamState,
  kind: PlannedItem["kind"],
  start: string,
  end: string,
  task: Task | null,
  locationId: string | null,
): PlannedItem {
  return {
    id: `tmp_${input.id_prefix}_${input.date}_${String(state.items.length + 1).padStart(3, "0")}`,
    kind,
    title: task?.title ?? (kind === "buffer" ? "バッファ" : "自由時間"),
    start_at: start,
    end_at: end,
    location_id: locationId,
    task_id: task?.id ?? null,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
    reason_code: null,
  };
}

function appendItem(items: PlannedItem[], item: PlannedItem): PlannedItem[] {
  if (diffMinutesExact(item.start_at, item.end_at) <= 0) return items;
  const previous = items.at(-1);
  if (previous && previous.kind === item.kind && (item.kind === "free" || item.kind === "buffer") && previous.end_at === item.start_at && previous.location_id === item.location_id) {
    return [...items.slice(0, -1), { ...previous, end_at: item.end_at }];
  }
  return [...items, item];
}

function itemString(items: readonly PlannedItem[]): string {
  return items.map((item) => [item.kind, item.start_at, item.end_at, item.task_id ?? "", item.location_id ?? ""].join("|")).join(";");
}

export function enumerateQuotaLengths(quota: AllocationQuota, task: Task, remaining: number): number[] {
  if (quota.kind === "goal") return remaining > 0 ? [remaining] : [];
  if (!task.splittable) return remaining >= task.estimated_minutes ? [task.estimated_minutes] : [];
  const values: number[] = CONFIG.lengths.filter((length) => length <= remaining);
  if (remaining < 30 && remaining > 0 && remaining % 15 === 0) values.push(remaining);
  return [...new Set(values)].sort((a, b) => a - b);
}

export function enumerateTaskBuffers(hasTaskInGap: boolean, options: readonly number[] = CONFIG.bufferOptions): number[] {
  return hasTaskInGap ? [...options] : [0];
}

export function enumerateFreeLengths(availableMinutes: number): number[] {
  return CONFIG.freeOptions.filter((minutes) => minutes + 15 <= availableMinutes);
}

function initialTaskMinutes(items: readonly ScheduleItem[]): number {
  return items.filter((item) => item.kind === "task").reduce((sum, item) => sum + Math.max(0, diffMinutesExact(item.start_at, item.end_at)), 0);
}

function enterSlot(input: DayBeamInput, state: BeamState, index: number): BeamState {
  const slot = input.slots[index];
  if (!slot) return { ...state, gapIndex: input.slots.length, done: true };
  let next: BeamState = { ...state, gapIndex: index, cursor: slot.start, last: "start", hasTaskInGap: false };
  if (diffMinutesExact(slot.start, slot.work_end) >= CONFIG.headBufferMinGap) {
    const end = addMinutes(slot.start, CONFIG.headBuffer);
    next = {
      ...next,
      cursor: end,
      last: "buffer",
      items: appendItem(next.items, makeItem(input, next, "buffer", slot.start, end, null, slot.location_id)),
    };
  }
  return next;
}

function bandStart(date: string, band: TimeBand): string {
  return atJstTime(date, band === "morning" ? "06:00" : band === "daytime" ? "12:00" : "18:00");
}

function maxTime(a: string, b: string): string {
  return diffMinutesExact(a, b) >= 0 ? b : a;
}

function placeTask(
  input: DayBeamInput,
  normalized: readonly NormalizedQuota[],
  tasks: ReadonlyMap<string, Task>,
  state: BeamState,
  quotaIndex: number,
  length: number,
  bufferMinutes: number,
): BeamState | null {
  const slot = input.slots[state.gapIndex];
  const entry = normalized[quotaIndex];
  const task = tasks.get(entry.quota.task_id);
  if (!slot || !task || length <= 0 || !Number.isFinite(length) || length > state.remaining[quotaIndex]) return null;

  const afterBuffer = addMinutes(state.cursor, bufferMinutes);
  const desired = entry.quota.kind === "goal" && entry.quota.band !== null
    ? maxTime(afterBuffer, bandStart(input.date, entry.quota.band))
    : afterBuffer;
  const start = ceilToMinutes(desired, 5);
  const bufferStart = addMinutes(start, -bufferMinutes);
  const preGap = diffMinutesExact(state.cursor, bufferStart);
  let items = state.items;
  if (preGap >= 15) {
    items = appendItem(items, makeItem(input, { ...state, items }, "free", state.cursor, bufferStart, null, slot.location_id));
  } else if (preGap > 0) {
    bufferMinutes += preGap;
  }
  const actualBufferStart = addMinutes(start, -bufferMinutes);
  if (bufferMinutes > 0) {
    items = appendItem(items, makeItem(input, { ...state, items }, "buffer", actualBufferStart, start, null, slot.location_id));
  }
  const end = addMinutes(start, length);
  if (diffMinutesExact(end, slot.work_end) < 0) return null;
  if (state.dayTaskMinutes + length > input.context.preferences.daily_work_limit_minutes) return null;
  if (entry.quota.deadline_at !== null && diffMinutesExact(end, entry.quota.deadline_at) < 0) return null;
  const fit = computeTaskFit({ context: input.context, task, slot, start, minutes: length, band: entry.quota.band });
  if (fit.fit <= 0) return null;
  items = appendItem(items, makeItem(input, { ...state, items }, "task", start, end, task, slot.location_id));
  const remaining = [...state.remaining];
  remaining[quotaIndex] -= length;
  return {
    ...state,
    cursor: end,
    last: "task",
    hasTaskInGap: true,
    remaining,
    dayTaskMinutes: state.dayTaskMinutes + length,
    items,
    fitMinuteSum: state.fitMinuteSum + fit.q * length,
    placedTaskMinutes: state.placedTaskMinutes + length,
  };
}

function addFree(input: DayBeamInput, state: BeamState, minutes: number): BeamState | null {
  const slot = input.slots[state.gapIndex];
  if (!slot || minutes + 15 > diffMinutesExact(state.cursor, slot.work_end)) return null;
  const end = addMinutes(state.cursor, minutes);
  return { ...state, cursor: end, last: "free", items: appendItem(state.items, makeItem(input, state, "free", state.cursor, end, null, slot.location_id)) };
}

function closeSlot(input: DayBeamInput, state: BeamState): BeamState {
  const slot = input.slots[state.gapIndex];
  if (!slot) return { ...state, done: true };
  let cursor = state.cursor;
  let items = state.items;
  const available = Math.max(0, diffMinutesExact(cursor, slot.work_end));
  if (state.last === "task" && available >= 15) {
    const end = addMinutes(cursor, 15);
    items = appendItem(items, makeItem(input, { ...state, items }, "buffer", cursor, end, null, slot.location_id));
    cursor = end;
  }
  if (diffMinutesExact(cursor, slot.work_end) > 0) {
    items = appendItem(items, makeItem(input, { ...state, items }, "free", cursor, slot.work_end, null, slot.location_id));
  }
  if (diffMinutesExact(slot.work_end, slot.end) > 0) {
    items = appendItem(items, makeItem(input, { ...state, items }, "free", slot.work_end, slot.end, null, slot.location_id));
  }
  return enterSlot(input, { ...state, cursor: slot.end, items }, state.gapIndex + 1);
}

function evaluate(
  input: DayBeamInput,
  normalized: readonly NormalizedQuota[],
  priorities: ReadonlyMap<string, number>,
  state: BeamState,
): BeamEvaluation {
  let achievementNumerator = 0;
  let achievementDenominator = 0;
  let requiredInitial = 0;
  let requiredPlaced = 0;
  for (let index = 0; index < normalized.length; index++) {
    const quota = normalized[index].quota;
    const placed = quota.minutes - state.remaining[index];
    const priority = priorities.get(quota.task_id) ?? 0;
    achievementNumerator += priority * placed;
    achievementDenominator += priority * quota.minutes;
    if (quota.required) {
      requiredInitial += quota.minutes;
      requiredPlaced += placed;
    }
  }
  const taskMinutes = state.placedTaskMinutes;
  const bufferMinutes = state.items.filter((item) => item.kind === "buffer").reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0);
  const freeMinutes = state.items.filter((item) => item.kind === "free").reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0);
  const totalSlotMinutes = input.slots.reduce((sum, slot) => sum + Math.max(0, diffMinutesExact(slot.start, slot.end)), 0);
  const rawRemainingCapacity = input.slots.reduce((sum, slot, index) => {
    if (index < state.gapIndex) return sum;
    const start = index === state.gapIndex ? state.cursor : slot.start;
    const head = index > state.gapIndex && diffMinutesExact(slot.start, slot.work_end) >= CONFIG.headBufferMinGap ? CONFIG.headBuffer : 0;
    return sum + Math.max(0, diffMinutesExact(start, slot.work_end) - head);
  }, 0);
  const requiredRemaining = normalized.reduce((sum, entry, index) => sum + (entry.quota.required ? state.remaining[index] : 0), 0);
  const requiredQuotaCount = normalized.filter((entry, index) => entry.quota.required && state.remaining[index] > 0).length;
  const freshGaps = input.slots.reduce((count, slot, index) => {
    if (index < state.gapIndex) return count;
    if (index === state.gapIndex) return count + Number(!state.hasTaskInGap && diffMinutesExact(state.cursor, slot.work_end) > 0);
    return count + Number(diffMinutesExact(slot.start, slot.work_end) > 0);
  }, 0);
  const minimumTaskBuffers = Math.max(0, requiredQuotaCount - freshGaps) * Math.min(...CONFIG.bufferOptions);
  const remainingCapacity = Math.max(0, Math.min(
    rawRemainingCapacity - minimumTaskBuffers,
    input.context.preferences.daily_work_limit_minutes - state.dayTaskMinutes,
  ));
  const maxOver = input.context.preferences.daily_work_limit_minutes - CONFIG.comfortableTaskMinutes;
  const achievement = achievementDenominator === 0 ? 1 : achievementNumerator / achievementDenominator;
  const fit = taskMinutes === 0 ? 0.5 : state.fitMinuteSum / taskMinutes;
  const deadlineSafety = requiredInitial === 0 ? 1 : requiredPlaced / requiredInitial;
  const buffer = taskMinutes === 0 ? 1 : Math.min(1, bufferMinutes / (0.5 * taskMinutes));
  const freeTime = totalSlotMinutes === 0 ? 1 : freeMinutes / totalSlotMinutes;
  const over = maxOver <= 0 ? Number(state.dayTaskMinutes > CONFIG.comfortableTaskMinutes) : Math.max(0, state.dayTaskMinutes - CONFIG.comfortableTaskMinutes) ** 2 / maxOver ** 2;
  const penalty = CONFIG.penaltyPerHour * Math.max(0, requiredRemaining - remainingCapacity) / 60;
  const [w1, w2, w3, w4, w5, w6] = input.weights;
  return { achievement, fit, deadline_safety: deadlineSafety, buffer, free_time: freeTime, over, penalty, score: w1 * achievement + w2 * fit + w3 * deadlineSafety + w4 * buffer + w5 * freeTime - w6 * over - penalty };
}

function stateKey(state: BeamState): string {
  return [state.gapIndex, state.cursor, state.last, state.hasTaskInGap ? 1 : 0, state.remaining.join(","), state.dayTaskMinutes].join("|");
}

function expand(input: DayBeamInput, normalized: readonly NormalizedQuota[], tasks: ReadonlyMap<string, Task>, state: BeamState): BeamState[] {
  if (state.done) return [];
  const slot = input.slots[state.gapIndex];
  if (!slot || diffMinutesExact(state.cursor, slot.work_end) <= 0) return [closeSlot(input, state)];
  const next: BeamState[] = [];
  for (let index = 0; index < normalized.length; index++) {
    if (state.remaining[index] <= 0) continue;
    const task = tasks.get(normalized[index].quota.task_id);
    if (!task) continue;
    for (const length of enumerateQuotaLengths(normalized[index].quota, task, state.remaining[index])) {
      const buffers = enumerateTaskBuffers(state.hasTaskInGap, input.buffer_options);
      for (const buffer of buffers) {
        const placed = placeTask(input, normalized, tasks, state, index, length, buffer);
        if (placed) next.push(placed);
      }
    }
  }
  for (const minutes of enumerateFreeLengths(diffMinutesExact(state.cursor, slot.work_end))) {
    const free = addFree(input, state, minutes);
    if (free) next.push(free);
  }
  next.push(closeSlot(input, state));
  return next;
}

/** planning.md P5: 1日分をビーム探索で配置する。 */
export function dayBeam(input: DayBeamInput): DayBeamResult {
  const normalized = normalizeQuotas(input.quotas);
  const tasks = new Map(input.context.tasks.map((task) => [task.id, task]));
  const priorityList = input.priorities ?? computeTaskPriorities(input.context, input.date);
  const priorities = new Map(priorityList.map((entry) => [entry.task_id, entry.score]));
  const evaluationCache = new WeakMap<BeamState, BeamEvaluation>();
  const itemStringCache = new WeakMap<BeamState, string>();
  const evaluateState = (state: BeamState) => {
    const cached = evaluationCache.get(state);
    if (cached) return cached;
    const value = evaluate(input, normalized, priorities, state);
    evaluationCache.set(state, value);
    return value;
  };
  const stateItems = (state: BeamState) => {
    const cached = itemStringCache.get(state);
    if (cached !== undefined) return cached;
    const value = itemString(state.items);
    itemStringCache.set(state, value);
    return value;
  };
  let initial: BeamState = {
    gapIndex: 0,
    cursor: input.slots[0]?.start ?? atJstTime(input.date, "00:00"),
    last: "start",
    hasTaskInGap: false,
    remaining: normalized.map((entry) => entry.quota.minutes),
    dayTaskMinutes: initialTaskMinutes(input.existing_items),
    items: [],
    done: input.slots.length === 0,
    fitMinuteSum: 0,
    placedTaskMinutes: 0,
  };
  if (!initial.done) initial = enterSlot(input, initial, 0);
  let beam = [initial];
  const finished: BeamState[] = [];
  let steps = 0;
  let maxBeamSize = 1;
  let deduplicatedStates = 0;
  for (; steps < CONFIG.beam.maxSteps; steps++) {
    const candidates: BeamState[] = [];
    for (const state of beam) {
      if (state.done) finished.push(state);
      else candidates.push(...expand(input, normalized, tasks, state));
    }
    if (candidates.length === 0) break;
    const unique = new Map<string, BeamState>();
    for (const candidate of candidates) {
      const key = stateKey(candidate);
      const current = unique.get(key);
      if (!current) unique.set(key, candidate);
      else {
        deduplicatedStates += 1;
        const left = evaluateState(candidate).score;
        const right = evaluateState(current).score;
        if (left > right || (left === right && stateItems(candidate) < stateItems(current))) unique.set(key, candidate);
      }
    }
    beam = [...unique.values()].sort((a, b) => evaluateState(b).score - evaluateState(a).score || compareText(stateItems(a), stateItems(b))).slice(0, CONFIG.beam.width);
    maxBeamSize = Math.max(maxBeamSize, beam.length);
  }
  const forcedClose = beam.some((state) => !state.done);
  for (const candidate of beam) {
    let state = candidate;
    while (!state.done) state = closeSlot(input, state);
    finished.push(state);
  }
  const best = finished.sort((a, b) => {
    const requiredA = normalized.reduce((sum, entry, index) => sum + (entry.quota.required ? a.remaining[index] : 0), 0);
    const requiredB = normalized.reduce((sum, entry, index) => sum + (entry.quota.required ? b.remaining[index] : 0), 0);
    return requiredA - requiredB || evaluateState(b).score - evaluateState(a).score || compareText(stateItems(a), stateItems(b));
  })[0] ?? initial;
  return {
    ok: true,
    date: input.date,
    items: best.items,
    remaining: normalized.map((entry, index) => ({ quota_key: entry.key, quota: entry.quota, initial_minutes: entry.quota.minutes, remaining_minutes: best.remaining[index] })),
    dayTaskMinutes: best.dayTaskMinutes,
    evaluation: evaluateState(best),
    steps,
    forced_close: forcedClose,
    required_complete: normalized.every((entry, index) => !entry.quota.required || best.remaining[index] === 0),
    max_beam_size: maxBeamSize,
    deduplicated_states: deduplicatedStates,
  };
}

export type WeekBuildResult =
  | { ok: true; direction: string; allocation: WeeklyAllocation["parameters"]; days: DayPlan[]; day_results: DayBeamResult[] }
  | { ok: false; direction: string; allocation: WeeklyAllocation["parameters"]; reason: string; date: string; remaining: QuotaRemaining[] };

export type BuildWeekOptions = {
  weightsByDate?: Readonly<Record<string, BeamWeights>>;
  skeletonDays?: readonly DayPlan[];
  slots?: readonly FreeSlot[];
  priorities?: readonly TaskPriority[];
  cache?: Map<string, DayBeamResult>;
  bufferOptions?: readonly number[];
};

function stableDayInput(input: DayBeamInput): string {
  return JSON.stringify({ date: input.date, slots: input.slots, quotas: input.quotas, weights: input.weights, context: input.context, existing_items: input.existing_items, priorities: input.priorities, id_prefix: input.id_prefix, buffer_options: input.buffer_options });
}

/** planning.md P3.3・P5.6: 1つのallocationと方向から今日〜日曜を組み立てる。 */
export function buildWeekFromAllocation(
  context: PlanningContext,
  allocation: WeeklyAllocation,
  direction: keyof typeof CONFIG.beamWeights,
  options: BuildWeekOptions = {},
): WeekBuildResult {
  const built = options.skeletonDays ? { ok: true as const, days: [...options.skeletonDays] } : buildSkeleton(context);
  if (!built.ok) return { ok: false, direction, allocation: allocation.parameters, reason: built.infeasible.reason, date: toDateStr(context.now), remaining: [] };
  const slots = options.slots ?? buildFreeSlots(context, built.days);
  const priorities = options.priorities ?? computeTaskPriorities(context, toDateStr(context.now));
  const cache = options.cache ?? new Map<string, DayBeamResult>();
  const carry = new Map<string, AllocationQuota[]>();
  const dayResults: DayBeamResult[] = [];
  const generated = new Map<string, PlannedItem[]>();
  const sunday = addDays(context.week_start, 6);

  for (const day of allocation.days) {
    const original = [...day.quotas, ...(carry.get(day.date) ?? [])];
    const existing = [...(built.days.find((entry) => entry.date === day.date)?.items ?? []), ...context.locked_items.filter((item) => toDateStr(item.start_at) === day.date)];
    const beamInput: DayBeamInput = {
      date: day.date,
      slots: slots.filter((slot) => toDateStr(slot.start) === day.date),
      quotas: original,
      weights: options.weightsByDate?.[day.date] ?? CONFIG.beamWeights[direction],
      context,
      existing_items: existing,
      priorities,
      id_prefix: direction,
      buffer_options: options.bufferOptions,
    };
    const run = (value: DayBeamInput) => {
      const key = stableDayInput(value);
      const cached = cache.get(key);
      if (cached) return structuredClone(cached);
      const result = dayBeam(value);
      cache.set(key, structuredClone(result));
      return result;
    };
    let result = run(beamInput);
    if (day.date === sunday && result.remaining.some((entry) => entry.quota.kind === "goal" && entry.quota.required && entry.remaining_minutes > 0)) {
      result = run({ ...beamInput, quotas: original.map((quota) => quota.kind === "goal" ? { ...quota, band: null } : quota) });
    }
    dayResults.push(result);
    generated.set(day.date, result.items);

    for (const entry of result.remaining) {
      if (!entry.quota.required || entry.remaining_minutes <= 0) continue;
      const nextQuota = { ...entry.quota, minutes: entry.remaining_minutes };
      if (entry.quota.kind === "deadline") {
        const deadline = toDateStr(entry.quota.deadline_at!);
        const lastDate = deadline === toDateStr(context.now) ? deadline : addDays(deadline, -1);
        const nextDate = addDays(day.date, 1);
        if (nextDate > lastDate || nextDate > sunday) return { ok: false, direction, allocation: allocation.parameters, reason: `${entry.quota.task_id}の締切クォータを繰り越せません`, date: day.date, remaining: result.remaining };
        carry.set(nextDate, [...(carry.get(nextDate) ?? []), nextQuota]);
      } else if (entry.quota.kind === "goal") {
        const nextDate = addDays(day.date, 1);
        if (day.date === sunday || nextDate > sunday) return { ok: false, direction, allocation: allocation.parameters, reason: `${entry.quota.task_id}の目標セッションを配置できません`, date: day.date, remaining: result.remaining };
        carry.set(nextDate, [...(carry.get(nextDate) ?? []), nextQuota]);
      }
    }
  }

  const days = built.days.map((day) => {
    const items = [...day.items, ...context.locked_items.filter((item) => toDateStr(item.start_at) === day.date), ...(generated.get(day.date) ?? [])];
    const unique = new Map(items.map((item) => [[item.kind, item.start_at, item.end_at, item.task_id ?? "", item.location_id ?? ""].join("|"), item]));
    return { date: day.date, items: [...unique.values()].sort((a, b) => compareText(a.start_at, b.start_at) || compareText(a.id, b.id)) };
  });
  return { ok: true, direction, allocation: allocation.parameters, days, day_results: dayResults };
}
