import type { CSSProperties } from "react";
import { SCREEN_LABELS, getItemAppearance } from "@/lib/labels";
import { diffMinutes, formatDateLong, formatTimeRange, getDayOfMonth, getWeekdayJa } from "@/lib/datetime";
import type { DayView, ScheduleItem } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/** 表示する時間帯（mock-spec.md 2.6：7:00〜24:00） */
const START_HOUR = 7;
const END_HOUR = 24;
/** 1時間の高さ（mock-spec.md 2.6：1時間＝32px） */
const HOUR_HEIGHT = 32;
/** 文字を入れるブロックの最低の高さ（これより低いブロックは色だけ） */
const MIN_LABEL_HEIGHT = 22;

const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

type WeekGridProps = {
  /** 月曜から7日分 */
  days: DayView[];
  /** 今日（demo_now の日付）。列見出しを強調する */
  today: string;
  /** 列見出しをタップしたとき（その日の日表示へ） */
  onDaySelect: (date: string) => void;
};

/**
 * 週表示の縦タイムグリッド（mock-spec.md 2.6）。
 * 7列・7:00〜24:00・1時間＝32px。高さは所要時間に比例させる（design-spec.md 5.4：週表示だけ比例表示）。
 * ブロックは色だけで表し、文字は入る場合のみ短く表示する。
 */
export function WeekGrid({ days, today, onDaySelect }: WeekGridProps) {
  return (
    <div className="flex flex-col">
      {/* 列見出し「5 月」。タップでその日の日表示へ */}
      <div className="flex">
        <div className="w-8 shrink-0" />
        {days.map((day) => {
          const isToday = day.date === today;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onDaySelect(day.date)}
              aria-label={formatDateLong(day.date)}
              aria-current={isToday ? "date" : undefined}
              className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-xl outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                  isToday && "text-white",
                )}
                style={isToday ? { backgroundColor: "var(--brand-purple)" } : undefined}
              >
                {getDayOfMonth(day.date)}
              </span>
              <span className="text-[10px] text-muted-foreground">{getWeekdayJa(day.date)}</span>
            </button>
          );
        })}
      </div>

      <div className="relative mt-1 flex" style={{ height: GRID_HEIGHT }}>
        {/* 時刻の列と1時間ごとの線 */}
        <div className="relative w-8 shrink-0">
          {HOURS.map((hour) => (
            <span
              key={hour}
              className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
              style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
            >
              {hour}:00
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 left-8" aria-hidden>
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="absolute inset-x-0 border-t"
              style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
            />
          ))}
        </div>

        {days.map((day) => (
          <ol
            key={day.date}
            aria-label={formatDateLong(day.date)}
            className={cn("relative min-w-0 flex-1 border-l", day.date === today && "bg-(--brand-purple-pale)/30")}
          >
            {day.items.map((item) => (
              <WeekBlock key={item.id} item={item} date={day.date} />
            ))}
          </ol>
        ))}
      </div>
    </div>
  );
}

/** 7:00〜24:00 の枠に収まる部分の上端と高さ（px）。枠の外なら null */
function blockPosition(item: ScheduleItem, date: string): { top: number; height: number } | null {
  const start = Math.max(diffMinutes(date, item.start_at), START_HOUR * 60);
  const end = Math.min(diffMinutes(date, item.end_at), END_HOUR * 60);
  if (end <= start) return null;
  return {
    top: ((start - START_HOUR * 60) / 60) * HOUR_HEIGHT,
    height: ((end - start) / 60) * HOUR_HEIGHT,
  };
}

/** ブロックに入れる短い文字（余白・移動は種類の表示名） */
function shortLabel(item: ScheduleItem): string {
  if (item.kind === "buffer") return SCREEN_LABELS.buffer;
  if (item.kind === "travel" || item.kind === "sleep") return getItemAppearance(item.kind).label;
  return item.title;
}

/** 移動・余白は破線の枠、睡眠は枠なし、それ以外は左に細い線 */
function blockBorder(dashed: boolean, isSleep: boolean, color: string): CSSProperties {
  if (dashed) return { border: `1px dashed ${color}` };
  if (isSleep) return {};
  return { borderLeft: `3px solid ${color}` };
}

/**
 * 1つの予定のブロック。色は design-spec.md 2.3 の薄い背景＋左の細い線（丸印の色）。
 * 移動・余白は破線の枠、睡眠は薄い紫寄りの灰色
 */
function WeekBlock({ item, date }: { item: ScheduleItem; date: string }) {
  const position = blockPosition(item, date);
  if (!position) return null;

  const appearance = getItemAppearance(item.kind, item.fixed_category);
  const label = shortLabel(item);
  const isSleep = item.kind === "sleep";
  const showLabel = !isSleep && position.height >= MIN_LABEL_HEIGHT;

  return (
    <li
      className="absolute inset-x-px overflow-hidden rounded-[4px] px-0.5"
      style={{
        top: position.top + 1,
        height: Math.max(position.height - 2, 2),
        backgroundColor: isSleep ? "var(--muted)" : appearance.blockBg,
        ...blockBorder(appearance.dashedBorder, isSleep, appearance.circleColor),
        opacity: item.status === "completed" ? 0.5 : undefined,
      }}
      title={`${label} ${formatTimeRange(item.start_at, item.end_at)}`}
    >
      <span className={showLabel ? "block truncate text-[9px] leading-tight font-medium" : "sr-only"}>
        {label}
        <span className="sr-only"> {formatTimeRange(item.start_at, item.end_at)}</span>
      </span>
    </li>
  );
}
