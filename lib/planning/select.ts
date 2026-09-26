import { addDays, diffMinutesExact, toDateStr } from "@/lib/datetime";
import type { DayPlan, ObjectiveVector, PlanStyle, PlanningContext } from "@/lib/schemas";
import { CONFIG } from "./config";
import type { BeamWeights } from "./day-beam";

const KEYS = ["achievement", "deadline_safety", "task_fit", "buffer", "free_time", "control", "recovery"] as const;
export type SelectablePlan = { key: string; days: DayPlan[]; features: ObjectiveVector };
export type AdjustedDirections = Record<PlanStyle, ObjectiveVector>;

const clip = (value: number) => Math.min(1, Math.max(0, value));
const stableItems = (plan: SelectablePlan) => plan.days.flatMap((day) => day.items).map((item) => [item.kind, item.start_at, item.end_at, item.task_id ?? ""].join("|")).join(";");

export function dominates(a: ObjectiveVector, b: ObjectiveVector, epsilon = 1e-9): boolean {
  return KEYS.every((key) => a[key] >= b[key] - epsilon) && KEYS.some((key) => a[key] > b[key] + epsilon);
}

export function paretoFilter<T extends SelectablePlan>(plans: readonly T[]): T[] {
  const sorted = [...plans].sort((a, b) => stableItems(a).localeCompare(stableItems(b)) || a.key.localeCompare(b.key));
  const unique: T[] = [];
  for (const plan of sorted) if (!unique.some((entry) => KEYS.every((key) => entry.features[key] === plan.features[key]))) unique.push(plan);
  return unique.filter((plan) => !unique.some((other) => other !== plan && dominates(other.features, plan.features)));
}

const euclidean = (a: ObjectiveVector, b: ObjectiveVector) => Math.sqrt(KEYS.reduce((sum, key) => sum + (a[key] - b[key]) ** 2, 0));
export const directionDistance = (features: ObjectiveVector, direction: ObjectiveVector) => euclidean(features, direction);
export const featureDistance = (a: SelectablePlan, b: SelectablePlan) => euclidean(a.features, b.features);

function structural(plan: SelectablePlan, now: string) {
  const items = plan.days.flatMap((day) => day.items).filter((item) => item.end_at > now);
  const sum = (kind: string) => items.filter((item) => item.kind === kind).reduce((total, item) => total + Math.max(0, diffMinutesExact(item.start_at < now ? now : item.start_at, item.end_at)), 0);
  return { work: sum("task"), buffer: sum("buffer"), free: sum("free"), count: items.filter((item) => item.kind === "task").length };
}

export function structuralDistance(a: SelectablePlan, b: SelectablePlan, now: string): number {
  const x = structural(a, now); const y = structural(b, now);
  return 0.25 * (Math.abs(x.work - y.work) / 600 + Math.abs(x.buffer - y.buffer) / 300 + Math.abs(x.free - y.free) / 600 + Math.abs(x.count - y.count) / 10);
}
export function integratedDistance(a: SelectablePlan, b: SelectablePlan, now: string): number { return CONFIG.diversity.lambdaF * featureDistance(a, b) + CONFIG.diversity.lambdaS * structuralDistance(a, b, now); }

function deadlineNear(context: PlanningContext): boolean {
  const today = toDateStr(context.now);
  return context.tasks.some((task) => task.deadline_at !== null && toDateStr(task.deadline_at) >= today && toDateStr(task.deadline_at) <= addDays(today, CONFIG.stateAdjust.deadlineNear.maxDays));
}

export function adjustedDirections(context: PlanningContext): AdjustedDirections {
  const result = structuredClone(CONFIG.directions) as AdjustedDirections;
  for (const style of ["intensive", "balanced", "relaxed"] as const) {
    const target = result[style];
    if (context.checkin?.date === toDateStr(context.now) && context.checkin.fatigue === "high") { target.recovery += 0.15; target.free_time += 0.1; target.achievement -= 0.1; }
    if (context.checkin?.date === toDateStr(context.now) && context.checkin.concentration === "low") target.task_fit += 0.1;
    if (deadlineNear(context)) target.deadline_safety += 0.1;
    for (const key of KEYS) target[key] = clip(target[key]);
  }
  return result;
}

export function adjustedBeamWeights(context: PlanningContext, style: PlanStyle, date: string): BeamWeights {
  const weights = [...CONFIG.beamWeights[style]] as number[];
  if (date === toDateStr(context.now)) {
    if (context.checkin?.date === date && context.checkin.fatigue === "high") { weights[4] += 0.1; weights[5] += 0.2; }
    if (context.checkin?.date === date && context.checkin.concentration === "low") weights[1] += 0.1;
    if (deadlineNear(context)) weights[2] += 0.1;
  }
  return weights.map(clip) as unknown as BeamWeights;
}

export type SelectionResult<T> = { plans: [T, T, T]; tooSimilar: boolean };
export function selectThree<T extends SelectablePlan>(all: readonly T[], directions: AdjustedDirections, now: string, minDistance: number = CONFIG.diversity.minDistance): SelectionResult<T> {
  if (all.length === 0) throw new RangeError("候補がありません");
  const stable = [...all].sort((a, b) => stableItems(a).localeCompare(stableItems(b)) || a.key.localeCompare(b.key));
  const pareto = paretoFilter(stable);
  const pool = [...pareto];
  for (const plan of stable.filter((entry) => !pool.includes(entry)).sort((a, b) => Math.min(...Object.values(directions).map((d) => directionDistance(a.features, d))) - Math.min(...Object.values(directions).map((d) => directionDistance(b.features, d))) || stableItems(a).localeCompare(stableItems(b)))) {
    if (pool.length >= 3) break; pool.push(plan);
  }
  while (pool.length < 3) pool.push(pool[0]);
  type Choice = { plans: [T, T, T]; value: number; key: string; diverse: boolean };
  const choices: Choice[] = [];
  for (let i = 0; i < pool.length; i++) for (let j = 0; j < pool.length; j++) for (let k = 0; k < pool.length; k++) {
    if (pool.length >= 3 && (i === j || i === k || j === k)) continue;
    const plans: [T, T, T] = [pool[i], pool[j], pool[k]];
    const distances = [integratedDistance(plans[0], plans[1], now), integratedDistance(plans[0], plans[2], now), integratedDistance(plans[1], plans[2], now)];
    choices.push({ plans, diverse: distances.every((d) => d >= minDistance), value: directionDistance(plans[0].features, directions.intensive) + directionDistance(plans[1].features, directions.balanced) + directionDistance(plans[2].features, directions.relaxed), key: plans.map(stableItems).join("||") });
  }
  const diverse = choices.filter((choice) => choice.diverse);
  const chosen = (diverse.length ? diverse : choices).sort((a, b) => a.value - b.value || a.key.localeCompare(b.key))[0];
  return { plans: chosen.plans, tooSimilar: diverse.length === 0 || new Set(chosen.plans.map((plan) => plan.key)).size < 3 };
}
