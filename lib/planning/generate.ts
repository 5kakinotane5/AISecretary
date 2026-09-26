import { addDays, diffMinutesExact, toDateStr } from "@/lib/datetime";
import { PLAN_STYLE_LABELS } from "@/lib/labels";
import { EngineGenerateResultSchema, EnginePlanSchema, PlanningContextSchema, type DayPlan, type EngineGenerateResult, type EnginePlan, type PlanStyle, type PlanningContext } from "@/lib/schemas";
import { buildWeeklyAllocations } from "./allocate";
import { buildWeekFromAllocation, type BeamWeights, type WeekBuildResult } from "./day-beam";
import { evaluateObjectives } from "./objectives";
import { computeTaskPriorities } from "./priority";
import { addBufferSuggestions, addIntensiveLightTask, applyGenerationReasons, buildExplanation } from "./reasons";
import { detectCapacityShortage, explainFailures } from "./recover";
import { adjustedBeamWeights, adjustedDirections, integratedDistance, selectThree, type SelectablePlan } from "./select";
import { buildSkeleton } from "./skeleton";
import { buildFreeSlots } from "./slots";
import { summarizePlan } from "./summarize";
import { validateCandidateDiversity, validatePlan } from "./validate";

type SearchCandidate = SelectablePlan & {
  week: Extract<WeekBuildResult, { ok: true }>;
  completion_target_dates: Readonly<Record<string, string>>;
};

function restyleIds(days: readonly DayPlan[], style: PlanStyle): DayPlan[] {
  return days.map((day) => {
    let sequence = 0;
    return { date: day.date, items: day.items.map((item) => item.locked ? { ...item } : { ...item, id: `tmp_${style}_${day.date}_${String(++sequence).padStart(3, "0")}` }) };
  });
}

function deadlineComplete(context: PlanningContext, days: readonly DayPlan[]): boolean {
  const sunday = addDays(context.week_start, 6);
  return context.tasks.filter((task) => task.deadline_at && toDateStr(task.deadline_at) <= sunday).every((task) => days.flatMap((day) => day.items).filter((item) => item.kind === "task" && item.task_id === task.id && item.end_at > context.now).reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0) >= task.remaining_minutes);
}

function search(context: PlanningContext, recovery: boolean) {
  const skeleton = buildSkeleton(context);
  if (!skeleton.ok) return { skeleton, candidates: [] as SearchCandidate[], failures: [] as WeekBuildResult[] };
  const slots = buildFreeSlots(context, skeleton.days);
  const shortage = detectCapacityShortage(context, slots);
  if (shortage) return { skeleton, slots, priorities: [] as ReturnType<typeof computeTaskPriorities>, candidates: [] as SearchCandidate[], failures: [] as WeekBuildResult[], shortage };
  const priorities = computeTaskPriorities(context, toDateStr(context.now));
  let allocations = buildWeeklyAllocations(context, slots, priorities);
  if (recovery) allocations = allocations.filter((allocation) => allocation.parameters.kappa === 0);
  const candidates: SearchCandidate[] = [];
  const failures: WeekBuildResult[] = [];
  const cache = new Map();
  for (const allocation of allocations) for (const direction of ["intensive", "balanced", "relaxed"] as const) {
    const weightsByDate: Record<string, BeamWeights> = { [toDateStr(context.now)]: adjustedBeamWeights(context, direction, toDateStr(context.now)) };
    const week = buildWeekFromAllocation(context, allocation, direction, { skeletonDays: skeleton.days, slots, priorities, cache, weightsByDate, bufferOptions: recovery ? [15] : undefined });
    if (!week.ok) { failures.push(week); continue; }
    if (validatePlan(context, week.days, "generate").errors.length || !deadlineComplete(context, week.days)) continue;
    const features = evaluateObjectives(context, week.days, { slots, dayResults: week.day_results, priorities });
    const completionTargetDates = Object.fromEntries(allocation.days.flatMap((day) => day.quotas).filter((quota) => quota.completion_target_date !== null).map((quota) => [quota.task_id, quota.completion_target_date!]));
    candidates.push({ key: JSON.stringify(week.days.map((day) => day.items.map((item) => [item.kind, item.start_at, item.end_at, item.task_id]))), days: week.days, features, week, completion_target_dates: completionTargetDates });
  }
  const unique = new Map(candidates.sort((a, b) => a.key.localeCompare(b.key)).map((candidate) => [candidate.key, candidate]));
  return { skeleton, slots, priorities, candidates: [...unique.values()], failures, shortage: null };
}

function finalize(context: PlanningContext, candidate: SearchCandidate, style: PlanStyle, slots: ReturnType<typeof buildFreeSlots>, priorities: ReturnType<typeof computeTaskPriorities>): EnginePlan {
  let days = restyleIds(candidate.days, style);
  days = addBufferSuggestions(context, days, priorities);
  if (style === "intensive") days = addIntensiveLightTask(context, days, priorities);
  days = restyleIds(days, style);
  days = applyGenerationReasons(context, days, style, candidate.completion_target_dates);
  const explanation = buildExplanation(context, days, style);
  const features = evaluateObjectives(context, days, { slots, dayResults: candidate.week.day_results, priorities });
  return EnginePlanSchema.parse({ style, label: PLAN_STYLE_LABELS[style], week_start: context.week_start, days, summary: summarizePlan(context, days, explanation), features });
}

/** planning.md P11: 決定論的に3案を生成する。 */
export function generatePlans(input: PlanningContext): EngineGenerateResult {
  const context = PlanningContextSchema.parse(structuredClone(input));
  let result = search(context, false);
  if (!result.skeleton.ok) return EngineGenerateResultSchema.parse({ ok: false, infeasible: result.skeleton.infeasible });
  if (result.shortage) return EngineGenerateResultSchema.parse({ ok: false, infeasible: result.shortage });
  if (result.candidates.length === 0) result = search(context, true);
  if (!result.skeleton.ok) return EngineGenerateResultSchema.parse({ ok: false, infeasible: result.skeleton.infeasible });
  if (result.candidates.length === 0) return EngineGenerateResultSchema.parse({ ok: false, infeasible: explainFailures(context, result.failures) });
  const selected = selectThree(result.candidates, adjustedDirections(context), context.now);
  const styles = ["intensive", "balanced", "relaxed"] as const;
  const plans = styles.map((style, index) => finalize(context, selected.plans[index], style, result.slots!, result.priorities!));
  const invalid = plans.some((plan) => validatePlan(context, plan.days, "generate").errors.length > 0);
  if (invalid) return EngineGenerateResultSchema.parse({ ok: false, infeasible: { feasible: false, reason: "生成後の計画を検証できませんでした。", required_changes: ["予定を調整する"] } });
  const diversity = validateCandidateDiversity(context, plans, "generate");
  const warnings = diversity.warnings;
  return EngineGenerateResultSchema.parse({ ok: true, plans, warnings });
}

export function planDistances(plans: readonly EnginePlan[], now: string): number[] {
  return [integratedDistance({ key: "0", days: plans[0].days, features: plans[0].features }, { key: "1", days: plans[1].days, features: plans[1].features }, now), integratedDistance({ key: "0", days: plans[0].days, features: plans[0].features }, { key: "2", days: plans[2].days, features: plans[2].features }, now), integratedDistance({ key: "1", days: plans[1].days, features: plans[1].features }, { key: "2", days: plans[2].days, features: plans[2].features }, now)];
}
