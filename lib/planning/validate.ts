import { atJstTime, diffMinutesExact } from "@/lib/datetime";
import {
  ValidationResultSchema,
  type DayPlan,
  type PlanningContext,
  type ScheduleItem,
  type ValidationIssue,
  type ValidationResult,
  type EnginePlan,
} from "@/lib/schemas";
import { CONFIG } from "./config";
import { integratedDistance } from "./select";

export type ValidationMode = "generate" | "replan" | "stored";

export type ValidatePlanOptions = {
  before?: readonly DayPlan[];
};

/** 10.11: 3案をまとめて検査する多様性warning。1案のvalidatePlanとは分離する。 */
export function validateCandidateDiversity(context: PlanningContext, plans: readonly EnginePlan[], mode: ValidationMode): ValidationResult {
  const warnings: ValidationIssue[] = [];
  if (mode !== "replan") {
    for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) {
      const left = { key: plans[i].style, days: plans[i].days, features: plans[i].features };
      const right = { key: plans[j].style, days: plans[j].days, features: plans[j].features };
      if (integratedDistance(left, right, context.now) < CONFIG.diversity.minDistance) warnings.push(makeIssue("CANDIDATES_TOO_SIMILAR", `${plans[i].label}と${plans[j].label}の違いが小さすぎます`, null, null));
    }
  }
  return ValidationResultSchema.parse({ valid: true, errors: [], warnings: sortAndDedupe(warnings) });
}

const ISSUE_ORDER: Readonly<Record<ValidationIssue["code"], number>> = {
  START_AFTER_END: 0,
  ITEM_OVERLAP: 1,
  FIXED_EVENT_OVERLAP: 2,
  SLEEP_OVERLAP: 3,
  TRAVEL_MISSING: 4,
  DEADLINE_VIOLATION: 5,
  BUFFER_SHORTAGE: 6,
  DAILY_LIMIT_EXCEEDED: 7,
  INVALID_REFERENCE: 8,
  FIXED_EVENT_MISMATCH: 9,
  GOAL_HOURS_MISMATCH: 10,
  PAST_PLACEMENT: 11,
  LOCKED_ITEM_CHANGED: 12,
  CANDIDATES_TOO_SIMILAR: 13,
};

function compareText(a: string | null, b: string | null): number {
  const left = a ?? "";
  const right = b ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
}

function byStartAndId(a: ScheduleItem, b: ScheduleItem): number {
  if (a.start_at !== b.start_at) return a.start_at < b.start_at ? -1 : 1;
  return compareText(a.id, b.id);
}

function overlaps(a: Pick<ScheduleItem, "start_at" | "end_at">, b: Pick<ScheduleItem, "start_at" | "end_at">): boolean {
  return a.start_at < b.end_at && b.start_at < a.end_at;
}

function minutes(item: ScheduleItem): number {
  return diffMinutesExact(item.start_at, item.end_at);
}

function makeIssue(
  code: ValidationIssue["code"],
  message: string,
  itemId: string | null,
  date: string | null,
): ValidationIssue {
  return { code, item_id: itemId, message, plan_id: null, date };
}

function sortAndDedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const unique = new Map<string, ValidationIssue>();
  for (const entry of issues) {
    const key = JSON.stringify([entry.code, entry.item_id, entry.plan_id, entry.date, entry.message]);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()].sort((a, b) => {
    const dateOrder = compareText(a.date, b.date);
    if (dateOrder !== 0) return dateOrder;
    const codeOrder = ISSUE_ORDER[a.code] - ISSUE_ORDER[b.code];
    if (codeOrder !== 0) return codeOrder;
    const itemOrder = compareText(a.item_id, b.item_id);
    if (itemOrder !== 0) return itemOrder;
    return compareText(a.message, b.message);
  });
}

function sleepRanges(context: PlanningContext, date: string): Array<{ start_at: string; end_at: string }> {
  const { sleep_start, sleep_end } = context.preferences;
  const start = atJstTime(date, sleep_start);
  const end = atJstTime(date, sleep_end);
  if (start < end) return [{ start_at: start, end_at: end }];
  if (start === end) return [];
  return [
    { start_at: atJstTime(date, "00:00"), end_at: end },
    { start_at: start, end_at: atJstTime(date, "24:00") },
  ];
}

function lockedItemChanged(before: ScheduleItem, after: ScheduleItem): boolean {
  return (
    before.kind !== after.kind ||
    before.title !== after.title ||
    before.start_at !== after.start_at ||
    before.end_at !== after.end_at ||
    before.location_id !== after.location_id ||
    before.task_id !== after.task_id ||
    before.fixed_event_id !== after.fixed_event_id ||
    before.fixed_category !== after.fixed_category ||
    JSON.stringify(before.travel) !== JSON.stringify(after.travel) ||
    before.suggested_task_id !== after.suggested_task_id ||
    before.locked !== after.locked ||
    before.status !== after.status ||
    before.reason !== after.reason
  );
}

/** planning.md 10.11: 生成・再計画・保存済み計画を同じ規則で検査する純粋関数。 */
export function validatePlan(
  context: PlanningContext,
  days: readonly DayPlan[],
  mode: ValidationMode,
  options: ValidatePlanOptions = {},
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const taskById = new Map(context.tasks.map((task) => [task.id, task]));
  const taskIds = new Set(taskById.keys());
  const historicalTaskIds = new Set(
    context.locked_items
      .filter((item) => item.task_id !== null && item.status === "completed")
      .map((item) => item.task_id as string),
  );
  const locationIds = new Set(context.locations.map((location) => location.id));
  const fixedById = new Map(context.fixed_events.map((event) => [event.id, event]));
  const goalIds = new Set(context.goals.map((goal) => goal.id));
  const goalTaskIds = new Map<string, Set<string>>();
  for (const goalId of goalIds) {
    goalTaskIds.set(
      goalId,
      new Set(context.tasks.filter((task) => task.goal_id === goalId).map((task) => task.id)),
    );
  }

  const sortedDays = [...days].sort((a, b) => compareText(a.date, b.date));
  for (const day of sortedDays) {
    const sorted = [...day.items].sort(byStartAndId);

    for (const item of sorted) {
      if (item.start_at >= item.end_at) {
        errors.push(
          makeIssue(
            "START_AFTER_END",
            `${item.title} の start_at が end_at より前になっていません`,
            item.id,
            day.date,
          ),
        );
      }
    }

    for (let left = 0; left < sorted.length; left += 1) {
      for (let right = left + 1; right < sorted.length; right += 1) {
        if (overlaps(sorted[left], sorted[right])) {
          errors.push(
            makeIssue(
              "ITEM_OVERLAP",
              `${sorted[left].title} と ${sorted[right].title} の時間が重なっています`,
              sorted[left].id,
              day.date,
            ),
          );
        }
      }
    }

    const fixedItems = sorted.filter((item) => item.kind === "fixed");
    const nonFixedItems = sorted.filter((item) => item.kind !== "fixed");
    for (const fixed of fixedItems) {
      for (const other of nonFixedItems) {
        if (overlaps(fixed, other)) {
          errors.push(
            makeIssue(
              "FIXED_EVENT_OVERLAP",
              `${other.title} が固定予定「${fixed.title}」の時間に重なっています`,
              other.id,
              day.date,
            ),
          );
        }
      }

      const source = fixed.fixed_event_id === null ? undefined : fixedById.get(fixed.fixed_event_id);
      if (
        source === undefined ||
        fixed.fixed_event_id !== source.id ||
        fixed.start_at !== source.start_at ||
        fixed.end_at !== source.end_at ||
        fixed.location_id !== source.location_id
      ) {
        errors.push(
          makeIssue(
            "FIXED_EVENT_OVERLAP",
            `固定予定「${fixed.title}」が登録済みの時刻・場所と一致しません`,
            fixed.id,
            day.date,
          ),
        );
      }
    }

    for (const item of sorted) {
      if (item.kind === "sleep") continue;
      for (const range of sleepRanges(context, day.date)) {
        if (overlaps(item, range)) {
          errors.push(
            makeIssue(
              "SLEEP_OVERLAP",
              `${item.title} が睡眠時間に重なっています`,
              item.id,
              day.date,
            ),
          );
          break;
        }
      }
    }

    const nonTravel = sorted.filter((item) => item.kind !== "travel" && item.location_id !== null);
    const travels = sorted.filter((item) => item.kind === "travel");
    for (let index = 0; index < nonTravel.length - 1; index += 1) {
      const previous = nonTravel[index];
      const next = nonTravel[index + 1];
      if (previous.location_id === next.location_id) continue;
      const route = context.travel_times.find(
        (entry) =>
          entry.from_location_id === previous.location_id && entry.to_location_id === next.location_id,
      );
      const bridge = travels.find(
        (item) =>
          item.travel?.from_location_id === previous.location_id &&
          item.travel?.to_location_id === next.location_id &&
          item.start_at >= previous.end_at &&
          item.end_at <= next.start_at,
      );

      if (bridge === undefined) {
        errors.push(
          makeIssue(
            "TRAVEL_MISSING",
            `${previous.title}（${previous.location_id}）から ${next.title}（${next.location_id}）への移動がありません`,
            next.id,
            day.date,
          ),
        );
        continue;
      }

      const actualMinutes = minutes(bridge);
      if (
        route === undefined ||
        bridge.travel?.mode !== route.mode ||
        actualMinutes !== route.minutes
      ) {
        errors.push(
          makeIssue(
            "TRAVEL_MISSING",
            `${bridge.title} の所要時間（${actualMinutes}分）または移動手段が移動時間表と一致しません`,
            bridge.id,
            day.date,
          ),
        );
      }
    }

    for (const item of sorted) {
      if (item.kind !== "task" || item.task_id === null) continue;
      const task = taskById.get(item.task_id);
      if (task?.deadline_at !== null && task?.deadline_at !== undefined && item.end_at > task.deadline_at) {
        errors.push(
          makeIssue(
            "DEADLINE_VIOLATION",
            `${item.title} が締切（${task.deadline_at}）を過ぎています`,
            item.id,
            day.date,
          ),
        );
      }
    }

    let pendingTask: ScheduleItem | null = null;
    for (const item of sorted) {
      if (item.kind === "fixed" || item.kind === "travel" || item.kind === "sleep") {
        pendingTask = null;
      } else if (item.kind === "task") {
        if (pendingTask !== null) {
          const gap = diffMinutesExact(pendingTask.end_at, item.start_at);
          if (gap < context.preferences.min_buffer_minutes) {
            errors.push(
              makeIssue(
                "BUFFER_SHORTAGE",
                `${pendingTask.title} と ${item.title} の間のバッファが${gap}分しかありません`,
                item.id,
                day.date,
              ),
            );
          }
        }
        pendingTask = item;
      }
    }

    const dailyTaskMinutes = sorted
      .filter((item) => item.kind === "task")
      .reduce((total, item) => total + minutes(item), 0);
    if (dailyTaskMinutes > context.preferences.daily_work_limit_minutes) {
      errors.push(
        makeIssue(
          "DAILY_LIMIT_EXCEEDED",
          `1日のタスク合計が${dailyTaskMinutes}分で上限を超えています`,
          null,
          day.date,
        ),
      );
    }

    for (const item of sorted) {
      if (item.location_id !== null && !locationIds.has(item.location_id)) {
        errors.push(
          makeIssue(
            "INVALID_REFERENCE",
            `location_id「${item.location_id}」が存在しません`,
            item.id,
            day.date,
          ),
        );
      }
      if (
        item.task_id !== null &&
        !taskIds.has(item.task_id) &&
        !(item.status === "completed" && historicalTaskIds.has(item.task_id))
      ) {
        errors.push(
          makeIssue(
            "INVALID_REFERENCE",
            `task_id「${item.task_id}」が存在しません`,
            item.id,
            day.date,
          ),
        );
      }
      if (item.fixed_event_id !== null && !fixedById.has(item.fixed_event_id)) {
        errors.push(
          makeIssue(
            "INVALID_REFERENCE",
            `fixed_event_id「${item.fixed_event_id}」が存在しません`,
            item.id,
            day.date,
          ),
        );
      }
      if (item.suggested_task_id !== null && !taskIds.has(item.suggested_task_id)) {
        errors.push(
          makeIssue(
            "INVALID_REFERENCE",
            `suggested_task_id「${item.suggested_task_id}」が存在しません`,
            item.id,
            day.date,
          ),
        );
      }
    }

    const dailyRestMinutes = sorted
      .filter((item) => item.kind === "buffer" || item.kind === "free")
      .reduce((total, item) => total + minutes(item), 0);
    if (dailyRestMinutes < context.preferences.min_daily_buffer_minutes) {
      warnings.push(
        makeIssue(
          "BUFFER_SHORTAGE",
          `1日のバッファ＋自由時間の合計が${dailyRestMinutes}分で、最低${context.preferences.min_daily_buffer_minutes}分を下回っています`,
          null,
          day.date,
        ),
      );
    }

    if (mode !== "stored") {
      for (const item of sorted) {
        if (!item.locked && item.start_at < context.now) {
          errors.push(
            makeIssue(
              "PAST_PLACEMENT",
              `${item.title} が現在時刻より前に新しく配置されています`,
              item.id,
              day.date,
            ),
          );
        }
      }
    }
  }

  const allItems = sortedDays.flatMap((day) => day.items);
  for (const goal of [...context.goals].sort((a, b) => compareText(a.id, b.id))) {
    const ids = goalTaskIds.get(goal.id) ?? new Set<string>();
    const actual = allItems
      .filter(
        (item) =>
          item.kind === "task" &&
          item.task_id !== null &&
          ids.has(item.task_id) &&
          (mode === "stored" || item.end_at > context.now),
      )
      .reduce((total, item) => total + minutes(item), 0);
    const weeklyTarget = context.goal_week_target_minutes[goal.id] ?? 0;
    const expected =
      mode === "stored"
        ? weeklyTarget
        : Math.max(0, weeklyTarget - (context.goal_done_minutes[goal.id] ?? 0));
    if (actual !== expected) {
      errors.push(
        makeIssue(
          "GOAL_HOURS_MISMATCH",
          `${goal.task_name}の週合計が${actual}分で、想定の${expected}分と異なります`,
          null,
          null,
        ),
      );
    }
  }

  if (mode === "replan") {
    const afterById = new Map(allItems.map((item) => [item.id, item]));
    const protectedBefore = options.before
      ?.flatMap((day) => day.items.map((item) => ({ date: day.date, item })))
      .filter(({ item }) => item.locked || item.status === "completed") ?? [];
    for (const { date, item: before } of protectedBefore) {
      const after = afterById.get(before.id);
      if (after === undefined) {
        errors.push(
          makeIssue(
            "LOCKED_ITEM_CHANGED",
            `${before.title} が再計画後になくなっています`,
            before.id,
            date,
          ),
        );
      } else if (lockedItemChanged(before, after)) {
        errors.push(
          makeIssue(
            "LOCKED_ITEM_CHANGED",
            `${before.title} の時刻または内容が変更されています`,
            before.id,
            date,
          ),
        );
      }
    }
  }

  const normalizedErrors = sortAndDedupe(errors);
  const normalizedWarnings = sortAndDedupe(warnings);
  return ValidationResultSchema.parse({
    valid: normalizedErrors.length === 0,
    errors: normalizedErrors,
    warnings: normalizedWarnings,
  });
}
