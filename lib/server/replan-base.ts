import type { SupabaseClient } from "@supabase/supabase-js";
import type { DayPlan, PlannedItem, PlanningContext, ScheduleItem } from "@/lib/schemas";
import { addDays, ceilToMinutes, diffMinutes, getWeekStart, toDateStr } from "@/lib/datetime";
import { withDisplayState } from "@/lib/server/calendar";
import { getNow } from "@/lib/server/clock";
import { HttpError } from "@/lib/server/http";
import { buildPlanningContext } from "@/lib/server/planning-context";
import { getActivePlan, listPlanItems, type PlanHeader, type PlanItemRow } from "@/lib/server/repositories/plans";
import { listPlanItemRows } from "@/lib/server/repositories/replan-proposals";

// 再計画の準備（plans-replan.md 12.2 の 1・2・5・6。replan-chat.md 12.11 の「1ターンの流れ」の 1）。
// POST /api/plans/replan と POST /api/plans/replan/chat で共通に使う。
// 足す予定（new_fixed_events）を context.fixed_events に入れるのは呼び出し側

export type ReplanBase =
  | { ok: false; reason: "not_today"; now: string; today: string }
  | {
      ok: true;
      now: string;
      today: string;
      active: PlanHeader;
      // 有効な計画の7日分。今日の項目には表示用の計算（11.3。locked・completed）をかけたもの
      beforeDays: DayPlan[];
      beforeToday: ScheduleItem[];
      // beforeDays に、保存されている reason_code を付けたもの（Engine・applyOps に渡す）
      engineBeforeDays: { date: string; items: PlannedItem[] }[];
      storedRows: Map<string, PlanItemRow>;
      // style ＝有効な計画の style。locked_items に今日の locked な項目と、now をまたぐ自由時間・バッファの前半
      context: PlanningContext;
    };

// locked_items に今日の locked な項目を足す。now をまたぐ自由時間・バッファ（locked: false）は、
// 作業用のコピーを now（5分単位に切り上げ）で切り、前半を locked の項目として入れる。後半は空きとして扱う
// （Before の項目は切らない）。DB・時計には触れない
export function withTodayLockedItems(
  context: PlanningContext,
  beforeToday: readonly ScheduleItem[],
  now: string,
): PlanningContext {
  const cut = ceilToMinutes(now, 5);
  const lockedToday: ScheduleItem[] = [];
  for (const item of beforeToday) {
    if (item.locked) {
      lockedToday.push(item);
    } else if (
      (item.kind === "free" || item.kind === "buffer") &&
      Date.parse(item.start_at) < Date.parse(now) &&
      Date.parse(cut) < Date.parse(item.end_at)
    ) {
      lockedToday.push({ ...item, id: `${item.id}_before_now`, end_at: cut, locked: true });
    }
  }
  const lockedIds = new Set(context.locked_items.map((item) => item.id));
  return {
    ...context,
    locked_items: [...context.locked_items, ...lockedToday.filter((item) => !lockedIds.has(item.id))],
  };
}

// 再計画の Validator（GOAL_HOURS_MISMATCH）に合わせて、目標の実施済み（goal_done_minutes）に
// 「Before の now までに終わった、未チェックの目標タスクの枠」の分を足す。DB・時計には触れない。
// Validator は now より後に終わる枠だけを数え、想定を W − D とする。一方 D は利用者がチェックした枠だけ（補正 C-23）なので、
// 過ぎたのにチェックしていない枠があると、その分だけ必ず食い違う（再計画は過去の枠を変えず、今後の目標の分も変えないため）。
// 再計画では、過ぎた枠は「もう動かせない分」として D と同じに扱う（チェック済みの枠はすでに D に入っているので足さない）
export function withPastGoalMinutes(
  context: PlanningContext,
  beforeDays: readonly DayPlan[],
  now: string,
): PlanningContext {
  if (context.goals.length === 0) return context;
  const goalOf = new Map(context.tasks.map((task) => [task.id, task.goal_id]));
  const done = { ...context.goal_done_minutes };
  for (const item of beforeDays.flatMap((day) => day.items)) {
    if (item.kind !== "task" || item.task_id === null || item.status === "completed") continue;
    if (Date.parse(item.end_at) > Date.parse(now)) continue;
    const goalId = goalOf.get(item.task_id);
    if (!goalId) continue;
    done[goalId] = (done[goalId] ?? 0) + diffMinutes(item.start_at, item.end_at);
  }
  return { ...context, goal_done_minutes: done };
}

// Before の項目に、保存されている reason_code を付ける
// （replan() は Before の項目をそのまま updated_days に写すため、ないと EngineReplanResultSchema に合わない）
export function withStoredReasonCodes(
  beforeDays: readonly DayPlan[],
  storedRows: ReadonlyMap<string, PlanItemRow>,
): { date: string; items: PlannedItem[] }[] {
  return beforeDays.map((day) => ({
    date: day.date,
    items: day.items.map((item) => ({ ...item, reason_code: storedRows.get(item.id)?.reason_code ?? null })),
  }));
}

export async function loadReplanBase(
  supabase: SupabaseClient,
  userId: string,
  date: string,
): Promise<ReplanBase> {
  // 1. 今日だけ（補正 C-12）
  const now = await getNow(userId, supabase);
  const today = toDateStr(now);
  if (date !== today) return { ok: false, reason: "not_today", now, today };

  // 2. 有効な計画が今週のもの
  const active = await getActivePlan(supabase);
  if (!active || active.week_start !== getWeekStart(today)) {
    throw new HttpError(409, "INVALID_STATE", "先にプランを選んでください");
  }

  // 5. Before：有効な計画の7日分に、表示用の計算（11.3。locked・completed）をかける
  const entries = (await listPlanItems(supabase, [active.id])).get(active.id) ?? [];
  const beforeDays: DayPlan[] = Array.from({ length: 7 }, (_, i) => addDays(active.week_start, i)).map(
    (day) => ({
      date: day,
      items: entries.filter((e) => e.date === day).map((e) => withDisplayState(e.item, now)),
    }),
  );
  const beforeToday = beforeDays.find((d) => d.date === today)?.items ?? [];

  // 6. PlanningContext：style ＝有効な計画の style、locked_items に今日の locked な項目。
  // 目標の実施済みに、過ぎた未チェックの目標タスクの枠を足す（withPastGoalMinutes）
  const context = withPastGoalMinutes(
    withTodayLockedItems(await buildPlanningContext(supabase, userId, active.style), beforeToday, now),
    beforeDays,
    now,
  );

  const storedRows = await listPlanItemRows(supabase, active.id);
  const engineBeforeDays = withStoredReasonCodes(beforeDays, storedRows);

  return { ok: true, now, today, active, beforeDays, beforeToday, engineBeforeDays, storedRows, context };
}
