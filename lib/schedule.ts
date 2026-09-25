import { diffMinutes } from "@/lib/datetime";
import type { ScheduleItem } from "@/lib/schemas";

/** 項目のうち kind が一致するものの合計時間（分）。画面（/today の合計）とモック（summary の計算）で共用する */
export function sumMinutesOfKind(items: ScheduleItem[], kind: ScheduleItem["kind"]): number {
  return items
    .filter((i) => i.kind === kind)
    .reduce((sum, i) => sum + diffMinutes(i.start_at, i.end_at), 0);
}
