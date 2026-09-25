import { SurfaceCard } from "@/components/common/SurfaceCard";
import { CALENDAR_LABELS, TODAY_LABELS, formatHours } from "@/lib/labels";
import { sumMinutesOfKind } from "@/lib/schedule";
import type { DayView } from "@/lib/schemas";

/**
 * 週表示の下の「今週のコンディション」風のカード（design-spec.md 6章）。
 * タスク時間・余白・自由時間の週の合計を、細い線のグラフで並べる（線の長さは3つのうち最大を100%とする）。
 */
export function WeekConditionCard({ days }: { days: DayView[] }) {
  const items = days.flatMap((day) => day.items);
  const rows = [
    { label: TODAY_LABELS.taskTotal, minutes: sumMinutesOfKind(items, "task"), color: "var(--kind-task)" },
    { label: TODAY_LABELS.bufferTotal, minutes: sumMinutesOfKind(items, "buffer"), color: "var(--kind-buffer)" },
    { label: TODAY_LABELS.freeTotal, minutes: sumMinutesOfKind(items, "free"), color: "var(--kind-free)" },
  ];
  const max = Math.max(...rows.map((row) => row.minutes), 1);

  return (
    <SurfaceCard className="flex flex-col gap-3">
      <h2 className="text-base font-bold">{CALENDAR_LABELS.conditionTitle}</h2>
      <dl className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-sm">
              <dt>{row.label}</dt>
              <dd className="font-bold tabular-nums">{formatHours(row.minutes / 60)}</dd>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full rounded-full"
                style={{ width: `${(row.minutes / max) * 100}%`, backgroundColor: row.color }}
              />
            </div>
          </div>
        ))}
      </dl>
    </SurfaceCard>
  );
}
