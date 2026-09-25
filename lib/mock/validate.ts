import { MockCheckResultSchema, type DayPlan, type MockCheckResult, type ScheduleItem, type ValidationIssue } from "@/lib/schemas";
import { diffMinutes } from "@/lib/datetime";
import { LOCATIONS, TRAVEL_TIMES, USER_PREFERENCE } from "@/mocks/persona";
import { TASKS } from "@/mocks/tasks";
import { FIXED_EVENTS } from "@/mocks/fixed-events";
import { GOAL } from "@/mocks/goal";
import { INTENSIVE_PLAN } from "@/mocks/plans/intensive";
import { BALANCED_PLAN } from "@/mocks/plans/balanced";
import { RELAXED_PLAN } from "@/mocks/plans/relaxed";
import { REPLAN_TIRED, REPLAN_WED_AFTER, REPLAN_THU_AFTER } from "@/mocks/replan-tired";

// ---------- 6章 ダミーデータの検査 ----------
// 3案（intensive / balanced / relaxed）・再計画のAfter・振り替え後の各日（10/7・10/8）について検査する。

const TASK_IDS = new Set(TASKS.map((t) => t.id));
const LOCATION_IDS_SET = new Set(LOCATIONS.map((l) => l.id));
const FIXED_EVENT_IDS = new Set(FIXED_EVENTS.map((e) => e.id));
const TASK_BY_ID = new Map(TASKS.map((t) => [t.id, t]));
const GOAL_TASK_IDS = new Set(TASKS.filter((t) => t.goal_id === GOAL.id).map((t) => t.id));

type DayContext = { date: string; items: ScheduleItem[]; planId: string | null };

function byStartAt(a: ScheduleItem, b: ScheduleItem): number {
  return a.start_at.localeCompare(b.start_at);
}

function issue(
  code: ValidationIssue["code"],
  message: string,
  opts: { itemId?: string | null; planId?: string | null; date?: string | null } = {},
): ValidationIssue {
  return {
    code,
    item_id: opts.itemId ?? null,
    message,
    plan_id: opts.planId ?? null,
    date: opts.date ?? null,
  };
}

function overlaps(a: ScheduleItem, b: ScheduleItem): boolean {
  return a.start_at < b.end_at && b.start_at < a.end_at;
}

function checkDay(ctx: DayContext, errors: ValidationIssue[], warnings: ValidationIssue[]): void {
  const { date, items, planId } = ctx;
  const sorted = [...items].sort(byStartAt);
  const tag = { planId, date };

  // START_AFTER_END
  for (const item of sorted) {
    if (!(item.start_at < item.end_at)) {
      errors.push(
        issue("START_AFTER_END", `${item.title} の start_at が end_at より前になっていません`, {
          itemId: item.id,
          ...tag,
        }),
      );
    }
  }

  // ITEM_OVERLAP（同じ日の項目同士。隣接はOK）
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (overlaps(sorted[i], sorted[j])) {
        errors.push(
          issue("ITEM_OVERLAP", `${sorted[i].title} と ${sorted[j].title} の時間が重なっています`, {
            itemId: sorted[i].id,
            ...tag,
          }),
        );
      }
    }
  }

  // FIXED_EVENT_OVERLAP（タスク・バッファ・自由時間が固定予定を侵食していないか）
  const fixedItems = sorted.filter((i) => i.kind === "fixed");
  const movable = sorted.filter((i) => i.kind === "task" || i.kind === "buffer" || i.kind === "free");
  for (const fixed of fixedItems) {
    for (const m of movable) {
      if (overlaps(fixed, m)) {
        errors.push(
          issue("FIXED_EVENT_OVERLAP", `${m.title} が固定予定「${fixed.title}」の時間に重なっています`, {
            itemId: m.id,
            ...tag,
          }),
        );
      }
    }
  }

  // SLEEP_OVERLAP（睡眠 0:00–7:30 に何も置かれていない）
  const sleepStart = `${date}T00:00:00+09:00`;
  const sleepEnd = `${date}T${USER_PREFERENCE.sleep_end}:00+09:00`;
  for (const item of sorted) {
    if (item.kind === "sleep") continue;
    if (item.start_at < sleepEnd && sleepStart < item.end_at) {
      errors.push(
        issue("SLEEP_OVERLAP", `${item.title} が睡眠時間（0:00–${USER_PREFERENCE.sleep_end}）に重なっています`, {
          itemId: item.id,
          ...tag,
        }),
      );
    }
  }

  // TRAVEL_MISSING（travel以外を時刻順に並べ、location_id が変わる箇所に正しい長さのtravelがあるか）
  const nonTravel = sorted.filter((i) => i.kind !== "travel");
  const travels = sorted.filter((i) => i.kind === "travel");
  for (let i = 0; i < nonTravel.length - 1; i += 1) {
    const prev = nonTravel[i];
    const next = nonTravel[i + 1];
    if (prev.location_id === null || next.location_id === null || prev.location_id === next.location_id) continue;
    const bridging = travels.find(
      (t) =>
        t.travel?.from_location_id === prev.location_id &&
        t.travel?.to_location_id === next.location_id &&
        t.start_at >= prev.end_at &&
        t.end_at <= next.start_at,
    );
    if (!bridging) {
      errors.push(
        issue(
          "TRAVEL_MISSING",
          `${prev.title}（${prev.location_id}）から ${next.title}（${next.location_id}）への移動がありません`,
          { itemId: next.id, ...tag },
        ),
      );
      continue;
    }
    const expected = TRAVEL_TIMES.find(
      (t) => t.from_location_id === bridging.travel?.from_location_id && t.to_location_id === bridging.travel?.to_location_id,
    );
    const actualMinutes = diffMinutes(bridging.start_at, bridging.end_at);
    if (!expected || actualMinutes !== expected.minutes) {
      errors.push(
        issue(
          "TRAVEL_MISSING",
          `${bridging.title} の所要時間（${actualMinutes}分）が移動時間表と一致しません`,
          { itemId: bridging.id, ...tag },
        ),
      );
    }
  }

  // DEADLINE_VIOLATION（締切を過ぎたタスクがない）
  for (const item of sorted) {
    if (item.kind !== "task" || !item.task_id) continue;
    const task = TASK_BY_ID.get(item.task_id);
    if (task?.deadline_at && item.end_at > task.deadline_at) {
      errors.push(
        issue("DEADLINE_VIOLATION", `${item.title} が締切（${task.deadline_at}）を過ぎています`, {
          itemId: item.id,
          ...tag,
        }),
      );
    }
  }

  // BUFFER_SHORTAGE（error）：タスクとタスクが移動・固定予定を挟まずに続くとき、間に15分以上のバッファがあるか
  let pendingTask: ScheduleItem | null = null;
  for (const item of sorted) {
    if (item.kind === "fixed" || item.kind === "travel" || item.kind === "sleep") {
      pendingTask = null; // 移動・固定予定を挟んだらリセット
      continue;
    }
    if (item.kind === "task") {
      if (pendingTask) {
        const gap = diffMinutes(pendingTask.end_at, item.start_at);
        if (gap < USER_PREFERENCE.min_buffer_minutes) {
          errors.push(
            issue("BUFFER_SHORTAGE", `${pendingTask.title} と ${item.title} の間のバッファが${gap}分しかありません`, {
              itemId: item.id,
              ...tag,
            }),
          );
        }
      }
      pendingTask = item;
    }
    // buffer・free は pendingTask を維持したまま次のタスクまで探索を続ける
  }

  // DAILY_LIMIT_EXCEEDED（1日のタスク合計が360分以下）
  const dailyTaskMinutes = sorted
    .filter((i) => i.kind === "task")
    .reduce((sum, i) => sum + diffMinutes(i.start_at, i.end_at), 0);
  if (dailyTaskMinutes > USER_PREFERENCE.daily_work_limit_minutes) {
    errors.push(
      issue("DAILY_LIMIT_EXCEEDED", `1日のタスク合計が${dailyTaskMinutes}分で上限を超えています`, { ...tag }),
    );
  }

  // INVALID_REFERENCE
  for (const item of sorted) {
    if (item.location_id !== null && !LOCATION_IDS_SET.has(item.location_id)) {
      errors.push(issue("INVALID_REFERENCE", `location_id「${item.location_id}」が存在しません`, { itemId: item.id, ...tag }));
    }
    if (item.task_id !== null && !TASK_IDS.has(item.task_id)) {
      errors.push(issue("INVALID_REFERENCE", `task_id「${item.task_id}」が存在しません`, { itemId: item.id, ...tag }));
    }
    if (item.fixed_event_id !== null && !FIXED_EVENT_IDS.has(item.fixed_event_id)) {
      errors.push(
        issue("INVALID_REFERENCE", `fixed_event_id「${item.fixed_event_id}」が存在しません`, { itemId: item.id, ...tag }),
      );
    }
    if (item.suggested_task_id !== null && !TASK_IDS.has(item.suggested_task_id)) {
      errors.push(
        issue("INVALID_REFERENCE", `suggested_task_id「${item.suggested_task_id}」が存在しません`, {
          itemId: item.id,
          ...tag,
        }),
      );
    }
  }

  // BUFFER_SHORTAGE（warning）：1日のバッファ合計が60分未満（タスクの少ない日は自由時間で代替できるため警告扱い）
  const dailyBufferMinutes = sorted
    .filter((i) => i.kind === "buffer")
    .reduce((sum, i) => sum + diffMinutes(i.start_at, i.end_at), 0);
  if (dailyBufferMinutes < USER_PREFERENCE.min_daily_buffer_minutes) {
    warnings.push(
      issue("BUFFER_SHORTAGE", `1日のバッファ合計が${dailyBufferMinutes}分で、最低${USER_PREFERENCE.min_daily_buffer_minutes}分を下回っています`, {
        ...tag,
      }),
    );
  }
}

/** 固定予定（5.6）の時刻・場所がどの案でも同じか（モック専用） */
function checkFixedEventMismatch(plans: { id: string; days: DayPlan[] }[], errors: ValidationIssue[]): void {
  const byFixedEventId = new Map<string, { start_at: string; end_at: string; location_id: string | null; planId: string }[]>();
  for (const plan of plans) {
    for (const day of plan.days) {
      for (const item of day.items) {
        if (item.kind !== "fixed" || !item.fixed_event_id) continue;
        const list = byFixedEventId.get(item.fixed_event_id) ?? [];
        list.push({ start_at: item.start_at, end_at: item.end_at, location_id: item.location_id, planId: plan.id });
        byFixedEventId.set(item.fixed_event_id, list);
      }
    }
  }
  for (const [fixedEventId, entries] of byFixedEventId) {
    const [first, ...rest] = entries;
    for (const entry of rest) {
      if (entry.start_at !== first.start_at || entry.end_at !== first.end_at || entry.location_id !== first.location_id) {
        errors.push(
          issue("FIXED_EVENT_MISMATCH", `固定予定「${fixedEventId}」の時刻・場所が案によって異なります`, {
            itemId: fixedEventId,
            planId: entry.planId,
          }),
        );
      }
    }
  }
}

/** TOEIC（リスニング＋単語）の週合計が3案とも360分か（モック専用） */
function checkGoalHoursMismatch(plans: { id: string; days: DayPlan[] }[], errors: ValidationIssue[]): void {
  const EXPECTED_MINUTES = 360;
  for (const plan of plans) {
    const total = plan.days
      .flatMap((d) => d.items)
      .filter((i) => i.kind === "task" && i.task_id !== null && GOAL_TASK_IDS.has(i.task_id))
      .reduce((sum, i) => sum + diffMinutes(i.start_at, i.end_at), 0);
    if (total !== EXPECTED_MINUTES) {
      errors.push(
        issue("GOAL_HOURS_MISMATCH", `「${plan.id}」のTOEIC週合計が${total}分で、想定の${EXPECTED_MINUTES}分と異なります`, {
          planId: plan.id,
        }),
      );
    }
  }
}

export function validateMockData(): MockCheckResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const candidatePlans = [INTENSIVE_PLAN, BALANCED_PLAN, RELAXED_PLAN];

  for (const plan of candidatePlans) {
    for (const day of plan.days) {
      checkDay({ date: day.date, items: day.items, planId: plan.id }, errors, warnings);
    }
  }

  checkDay({ date: REPLAN_TIRED.after.date, items: REPLAN_TIRED.after.items, planId: null }, errors, warnings);
  checkDay({ date: REPLAN_WED_AFTER.date, items: REPLAN_WED_AFTER.items, planId: null }, errors, warnings);
  checkDay({ date: REPLAN_THU_AFTER.date, items: REPLAN_THU_AFTER.items, planId: null }, errors, warnings);

  checkFixedEventMismatch(candidatePlans, errors);
  checkGoalHoursMismatch(candidatePlans, errors);

  return MockCheckResultSchema.parse({ errors, warnings });
}
