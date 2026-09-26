import { addDays, addMinutes, atJstTime, ceilToMinutes, diffMinutesExact } from "@/lib/datetime";
import type { DayPlan, Infeasible, PlanningContext, ScheduleItem } from "@/lib/schemas";
import { buildSkeleton } from "./skeleton";

/** planning.md 10.5の内部型。日時はJSTのISO文字列。スキーマに既存のFreeSlot型はない。 */
export type FreeSlot = {
  start: string;
  end: string;
  work_end: string;
  location_id: PlanningContext["home_location_id"];
};

function earlier(a: string, b: string): string {
  return diffMinutesExact(a, b) >= 0 ? a : b;
}

function later(a: string, b: string): string {
  return diffMinutesExact(a, b) >= 0 ? b : a;
}

/**
 * planning.md 10.5・P11: 週内の空きを時刻順の配列で返す。
 * locked_itemsはbackend.md 8.3・plans-replan.md 12.2で選別済みの保持対象。
 * 進行中タスクは全体を除外し、自由時間・バッファは呼び出し側で切った保持部分だけを除外する。
 */
export function buildFreeSlots(
  context: PlanningContext,
  skeletonDays: readonly DayPlan[],
): FreeSlot[] {
  const now = ceilToMinutes(context.now, 5);
  // DB保存時にIDが変わるため、IDではなく占有区間と場所で骨組みのコピーを除重する。
  const occupied = new Map<string, ScheduleItem>();
  for (const entry of [...skeletonDays.flatMap((day) => day.items), ...context.locked_items]) {
    const key = JSON.stringify([
      entry.kind,
      entry.start_at,
      entry.end_at,
      entry.location_id,
      entry.travel?.from_location_id,
      entry.travel?.to_location_id,
    ]);
    if (!occupied.has(key)) occupied.set(key, entry);
  }
  const items = [...occupied.values()].sort(
    (a, b) =>
      diffMinutesExact(b.start_at, a.start_at) ||
      diffMinutesExact(b.end_at, a.end_at) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const slots: FreeSlot[] = [];

  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(context.week_start, offset);
    const dayStart = atJstTime(date, "00:00");
    const dayEnd = atJstTime(date, "24:00");
    if (diffMinutesExact(now, dayEnd) <= 0) continue;
    let cursor = dayStart;
    let location = context.home_location_id;

    const addGap = (end: string) => {
      const start = later(cursor, now);
      if (diffMinutesExact(start, end) < 15) return;
      // 00:00就寝は翌日の0:00。早朝就寝でも、起床後は次の就寝を基準にする。
      let bedtime = atJstTime(date, context.preferences.sleep_start);
      if (diffMinutesExact(start, bedtime) <= 0) {
        bedtime = atJstTime(addDays(date, 1), context.preferences.sleep_start);
      }
      const cutoff = addMinutes(bedtime, -30);
      slots.push({
        start,
        end,
        // 就寝前だけの空きは残し、作業可能分を0にする（負にしない）。
        work_end: later(start, earlier(end, cutoff)),
        location_id: location,
      });
    };

    for (const entry of items) {
      if (
        diffMinutesExact(entry.start_at, dayEnd) <= 0 ||
        diffMinutesExact(dayStart, entry.end_at) <= 0
      )
        continue;
      addGap(earlier(entry.start_at, dayEnd));
      // 重なる保持区間は和集合として除外する。重複分を二度引かず、cursorも戻さない。
      if (diffMinutesExact(cursor, entry.end_at) >= 0) {
        cursor = earlier(entry.end_at, dayEnd);
        location = entry.travel?.to_location_id ?? entry.location_id ?? location;
      }
    }
    addGap(dayEnd);
  }
  return slots;
}

/** 7.2にAPI側の失敗契約が未定義のため、正常な0分と区別して理由を伝える内部例外。 */
export class WeeklyFreeMinutesError extends Error {
  constructor(public readonly infeasible: Infeasible) {
    super(infeasible.reason);
    this.name = "WeeklyFreeMinutesError";
  }
}

/** planning.md 10.2・backend.md 7.2.2。目標・タスクに依存せず作業可能な空きを集計する。 */
export function computeWeeklyFreeMinutes(context: PlanningContext): number {
  const skeleton = buildSkeleton(context);
  if (!skeleton.ok) throw new WeeklyFreeMinutesError(skeleton.infeasible);
  return buildFreeSlots(context, skeleton.days).reduce(
    (total, slot) => total + diffMinutesExact(slot.start, slot.work_end),
    0,
  );
}
