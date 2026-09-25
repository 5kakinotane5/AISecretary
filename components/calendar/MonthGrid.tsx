import { Flag } from "lucide-react";
import { CALENDAR_LABELS, MONTH_KIND_DOT_COLORS } from "@/lib/labels";
import { formatDateLong, getDayOfMonth, getWeekdayJa } from "@/lib/datetime";
import type { MonthView } from "@/lib/schemas";

type MonthDay = MonthView["days"][number];

/** 月曜始まり（mock-spec.md 2.6） */
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"] as const;
/** 予定の種類ごとの小さな点の最大数（mock-spec.md 2.6） */
const MAX_DOTS = 3;

type MonthGridProps = {
  /** 1日から月末まで（days が空の月は呼び出し側で「データなし」を出す） */
  days: MonthDay[];
  /** 今日（demo_now の日付）。丸で囲む */
  today: string;
  /** 日付をタップしたとき（その日の日表示へ） */
  onDateSelect: (date: string) => void;
};

/**
 * 月表示（mock-spec.md 2.6）。月曜始まりの7列グリッド。
 * 各マス：日付（今日は丸で囲む）、締切の件数、計画がある日は薄い紫の背景、予定の種類ごとの小さな点（最大3つ）。
 * 週の行の下に「計画あり」の日を示す細い帯を引く。
 * 締切は赤を使わず締切バッジと同じ色、計画ありの背景は青ではなく紫にする（design-spec.md 2.0・9.3）。
 */
export function MonthGrid({ days, today, onDateSelect }: MonthGridProps) {
  const weeks = toWeeks(days);

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>

      {weeks.map((week, weekIndex) => (
        <div key={weekIndex} className="flex flex-col gap-0.5">
          <div className="grid grid-cols-7 gap-0.5">
            {week.map((day, i) =>
              day ? (
                <DayCell key={day.date} day={day} isToday={day.date === today} onSelect={onDateSelect} />
              ) : (
                <span key={`blank-${i}`} aria-hidden />
              ),
            )}
          </div>
          <PlanBand week={week} />
        </div>
      ))}

      <div className="mt-2 flex items-center justify-end gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-4 rounded-full" style={{ backgroundColor: "var(--brand-purple-light)" }} aria-hidden />
          {CALENDAR_LABELS.hasPlanLegend}
        </span>
        <span className="flex items-center gap-1">
          <Flag size={12} style={{ color: "var(--deadline-fg)" }} aria-hidden />
          {CALENDAR_LABELS.deadlineLegend}
        </span>
      </div>
    </div>
  );
}

/** 月曜始まりの週ごとに分ける。1日より前・月末より後は null で埋める */
function toWeeks(days: MonthDay[]): (MonthDay | null)[][] {
  if (days.length === 0) return [];
  const leading = WEEKDAYS.indexOf(getWeekdayJa(days[0].date) as (typeof WEEKDAYS)[number]);
  const cells: (MonthDay | null)[] = [...Array<null>(leading).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

function DayCell({
  day,
  isToday,
  onSelect,
}: {
  day: MonthDay;
  isToday: boolean;
  onSelect: (date: string) => void;
}) {
  const deadlineCount = day.deadlines.length;
  const labelParts = [
    formatDateLong(day.date),
    day.has_plan ? CALENDAR_LABELS.hasPlanLegend : null,
    deadlineCount > 0 ? `${CALENDAR_LABELS.deadlineLegend}${deadlineCount}件` : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      aria-label={labelParts.join("、")}
      aria-current={isToday ? "date" : undefined}
      className="flex min-h-14 min-w-0 flex-col items-center gap-0.5 rounded-xl py-1 outline-none hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring"
      style={day.has_plan ? { backgroundColor: "var(--kind-task-bg)" } : undefined}
    >
      <span
        className="flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums"
        style={isToday ? { border: "2px solid var(--brand-purple)", color: "var(--brand-purple)" } : undefined}
      >
        {getDayOfMonth(day.date)}
      </span>
      <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
        {day.kinds.slice(0, MAX_DOTS).map((kind) => (
          <span key={kind} className="size-1.5 rounded-full" style={{ backgroundColor: MONTH_KIND_DOT_COLORS[kind] }} />
        ))}
      </span>
      {deadlineCount > 0 ? (
        <span
          className="flex items-center gap-0.5 text-[10px] leading-none font-bold tabular-nums"
          style={{ color: "var(--deadline-fg)" }}
          aria-hidden
        >
          <Flag size={10} />
          {deadlineCount}
        </span>
      ) : null}
    </button>
  );
}

/** その週のうち計画がある日の下に細い帯を引く（mock-spec.md 2.6） */
function PlanBand({ week }: { week: (MonthDay | null)[] }) {
  const planned = week.map((day) => day?.has_plan ?? false);
  const first = planned.indexOf(true);
  if (first === -1) return <div className="h-1" aria-hidden />;
  const last = planned.lastIndexOf(true);
  return (
    <div className="grid h-1 grid-cols-7" aria-hidden>
      <span
        className="rounded-full"
        style={{ gridColumn: `${first + 1} / ${last + 2}`, backgroundColor: "var(--brand-purple-light)" }}
      />
    </div>
  );
}
