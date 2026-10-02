import { diffMinutes } from "@/lib/datetime";
import type { ScheduleItem } from "@/lib/schemas";

/** 項目のうち kind が一致するものの合計時間（分）。画面（/today の合計）とモック（summary の計算）で共用する */
export function sumMinutesOfKind(items: ScheduleItem[], kind: ScheduleItem["kind"]): number {
  return items
    .filter((i) => i.kind === kind)
    .reduce((sum, i) => sum + diffMinutes(i.start_at, i.end_at), 0);
}

/** 画面上の空き時間の表示名（design-spec.md 4章。内部の buffer も free もこの名前で出す） */
const FREE_TIME_TITLE = "空き時間";

/** mergeFreeTime の結果の1項目。まとめた自由時間は候補タスクを複数持てるよう、候補の id を配列でも持つ */
export type DisplayScheduleItem = ScheduleItem & { suggested_task_ids: string[] };

/**
 * 画面表示用に、内部の buffer を free として表示し、隣り合う自由時間を1つにまとめる（design-spec.md 4章、frontend.md 14.2）。
 * - kind: "buffer"・"free" は kind: "free"・タイトル「空き時間」にする（DB の free の title は「自由時間」のため、free も置き換える）
 * - 時刻順で、前の end_at と次の start_at が同じで location_id も同じ free 同士を1つにする（id・start_at は最初、end_at は最後）
 * - 候補タスク（suggested_task_id）は suggested_task_ids に重複なく集め、suggested_task_id には最初の1件を残す。
 *   理由（reason）は重複を除いて改行でつなぐ。locked は1つでも locked なら locked にする
 * Engine・API・DB の値は変えない（表示の直前にだけ通す）
 */
export function mergeFreeTime(items: ScheduleItem[]): DisplayScheduleItem[] {
  const sorted = [...items].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const result: DisplayScheduleItem[] = [];
  for (const item of sorted) {
    const display: DisplayScheduleItem =
      item.kind === "buffer" || item.kind === "free"
        ? { ...item, kind: "free", title: FREE_TIME_TITLE, suggested_task_ids: toIds(item.suggested_task_id) }
        : { ...item, suggested_task_ids: toIds(item.suggested_task_id) };
    const prev = result.at(-1);
    if (
      prev &&
      prev.kind === "free" &&
      display.kind === "free" &&
      prev.location_id === display.location_id &&
      Date.parse(prev.end_at) === Date.parse(display.start_at)
    ) {
      result[result.length - 1] = combine(prev, display);
    } else {
      result.push(display);
    }
  }
  return result;
}

function toIds(id: string | null): string[] {
  return id ? [id] : [];
}

function combine(a: DisplayScheduleItem, b: DisplayScheduleItem): DisplayScheduleItem {
  const suggestedIds = [...new Set([...a.suggested_task_ids, ...b.suggested_task_ids])];
  const reasons = [...new Set([a.reason, b.reason].flatMap((r) => (r ? r.split("\n") : [])))];
  return {
    ...a,
    title: FREE_TIME_TITLE,
    end_at: b.end_at,
    suggested_task_id: suggestedIds[0] ?? null,
    suggested_task_ids: suggestedIds,
    reason: reasons.length > 0 ? reasons.join("\n") : null,
    locked: a.locked || b.locked,
  };
}

/** 自由時間（内部の buffer＋free）の合計分。画面で「自由時間」として出す合計に使う */
export function sumFreeTimeMinutes(items: ScheduleItem[]): number {
  return sumMinutesOfKind(items, "buffer") + sumMinutesOfKind(items, "free");
}

/** 項目の候補タスクの id。mergeFreeTime を通した項目なら全件、通していなければ suggested_task_id の1件 */
export function suggestedTaskIdsOf(item: ScheduleItem): string[] {
  const ids = (item as Partial<DisplayScheduleItem>).suggested_task_ids;
  return ids ?? toIds(item.suggested_task_id);
}
