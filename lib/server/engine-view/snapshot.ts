import { addMinutes, atJstTime, diffMinutesExact, toDateStr } from "@/lib/datetime";
import type { DayPlan, ObjectiveVector, PlanningContext, ScheduleItem, Task } from "@/lib/schemas";
import { computeTaskFit, isHighConcentrationTask, type TaskFitResult } from "@/lib/planning/fit";
import { evaluateObjectives } from "@/lib/planning/objectives";
import { adjustedBeamWeights, adjustedDirections, directionDistance, type AdjustedDirections } from "@/lib/planning/select";
import { buildSkeleton } from "@/lib/planning/skeleton";
import { buildFreeSlots } from "@/lib/planning/slots";
import type { DirectionDistances, FitRow, ParamSnapshot } from "./events";

// 発表用の別画面に出す Planning Engine のパラメータを計算する。純粋関数（DB・時計・環境変数に触れない）。
// 計算に失敗したら null・空配列にする（画面に「計算できませんでした」と出す）

const STYLES = ["intensive", "balanced", "relaxed"] as const;

type Days = readonly { date: string; items: readonly ScheduleItem[] }[];

// その日のタスクを置ける終わり（就寝の30分前）。lib/planning/replan.ts の workEnd() と同じ式
// （lib/planning は変えないため、export されていない関数をここに写す）
function workEnd(context: PlanningContext, date: string): string {
  const end = atJstTime(date, "24:00");
  const sleep = context.preferences.sleep_start === "00:00" ? "24:00" : context.preferences.sleep_start;
  const cutoff = addMinutes(atJstTime(date, sleep), -30);
  return end < cutoff ? end : cutoff;
}

// タスク項目の Fit（P4）。replan.ts の state_change で Fit を求める所と同じ形
// （開始は max(start_at, now)、slot はその時刻〜work_end、band は null）
function itemFit(context: PlanningContext, item: ScheduleItem, task: Task): { start: string; minutes: number; fit: TaskFitResult } {
  const start = item.start_at < context.now ? context.now : item.start_at;
  const minutes = diffMinutesExact(start, item.end_at);
  const end = workEnd(context, toDateStr(start));
  const fit = computeTaskFit({
    context,
    task,
    slot: { start, end, work_end: end, location_id: item.location_id ?? context.home_location_id },
    start,
    minutes,
    band: null,
  });
  return { start, minutes, fit };
}

const findTask = (context: PlanningContext, taskId: string | null) =>
  taskId === null ? undefined : context.tasks.find((task) => task.id === taskId);

function todayFits(context: PlanningContext, days: Days | null): FitRow[] {
  if (!days) return [];
  const today = toDateStr(context.now);
  const items = days.find((day) => day.date === today)?.items ?? [];
  return [...items]
    .filter((item) => item.kind === "task" && item.end_at > context.now && item.status !== "completed")
    .sort((a, b) => (a.start_at < b.start_at ? -1 : a.start_at > b.start_at ? 1 : 0))
    .flatMap((item) => {
      const task = findTask(context, item.task_id);
      if (!task) return [];
      const { fit } = itemFit(context, item, task);
      return [
        {
          item_id: item.id,
          title: item.title,
          start_at: item.start_at,
          end_at: item.end_at,
          high_concentration: isHighConcentrationTask(task),
          ...fit,
        },
      ];
    });
}

// 状態 s_t・D_k(s_t)・今日のビームの w_k・今日のタスクの Fit。days が null（有効な計画がない）なら today_fits は空
export function buildParamSnapshot(context: PlanningContext, days: Days | null): ParamSnapshot {
  const today = toDateStr(context.now);
  const checkin = context.checkin?.date === today ? context.checkin : null;
  let fits: FitRow[] = [];
  try {
    fits = todayFits(context, days);
  } catch {
    fits = [];
  }
  return {
    checkin: {
      fatigue: checkin?.fatigue ?? null,
      concentration: checkin?.concentration ?? null,
      mood: checkin?.mood ?? null,
    },
    directions: adjustedDirections(context),
    beam_weights: Object.fromEntries(
      STYLES.map((style) => [style, [...adjustedBeamWeights(context, style, today)]]),
    ) as ParamSnapshot["beam_weights"],
    today_fits: fits,
  };
}

// 計画の目的ベクトル F(S)（P6）。slots は骨組みから作った空き。
// evaluateObjectives は dayResults がないと task_fit が常に 1 になるので、task_fit だけは
// 「now より後のタスク項目の q を、分数で加重平均したもの」（タスクがなければ 1）で上書きする
export function computeFeatures(context: PlanningContext, days: Days | null): ObjectiveVector | null {
  if (!days) return null;
  try {
    const skeleton = buildSkeleton(context);
    if (!skeleton.ok) return null;
    const slots = buildFreeSlots(context, skeleton.days);
    const features = evaluateObjectives(context, days as DayPlan[], { slots });

    let minutes = 0;
    let weighted = 0;
    for (const item of days.flatMap((day) => day.items)) {
      if (item.kind !== "task" || item.end_at <= context.now) continue;
      const task = findTask(context, item.task_id);
      if (!task) continue;
      const fit = itemFit(context, item, task);
      if (fit.minutes <= 0) continue;
      minutes += fit.minutes;
      weighted += fit.fit.q * fit.minutes;
    }
    return { ...features, task_fit: minutes === 0 ? 1 : Math.min(1, Math.max(0, weighted / minutes)) };
  } catch {
    return null;
  }
}

// F(S) と3方向の D_k との距離（P8.2）
export function directionDistances(
  features: ObjectiveVector | null,
  directions: AdjustedDirections,
): DirectionDistances | null {
  if (!features) return null;
  try {
    return {
      intensive: directionDistance(features, directions.intensive),
      balanced: directionDistance(features, directions.balanced),
      relaxed: directionDistance(features, directions.relaxed),
    };
  } catch {
    return null;
  }
}
