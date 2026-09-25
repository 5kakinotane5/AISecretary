import type { CSSProperties } from "react";
import { WEEK_LEGEND_ITEMS, formatWeekColumnLabel, getItemAppearance, getTravelIcon, type ItemAppearance } from "@/lib/labels";
import { diffMinutes, formatDateLong, getDayOfMonth, getWeekdayJa } from "@/lib/datetime";
import { sumMinutesOfKind } from "@/lib/schedule";
import type { DayView, ScheduleItem } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/** 表示する時間帯（mock-spec.md 2.6：7:00〜24:00） */
const START_HOUR = 7;
const END_HOUR = 24;
/** 1時間の高さ（mock-spec.md 2.6：1時間＝32px） */
const HOUR_HEIGHT = 32;
/** アイコンを出すブロックの最低の高さ（これより低いブロックは色だけ。mock-spec.md 10.22） */
const MIN_ICON_HEIGHT = 24;

const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

type WeekGridProps = {
  /** 月曜から7日分 */
  days: DayView[];
  /** 今日（demo_now の日付）。列見出しを強調する */
  today: string;
  /** 列見出し・ブロック（その日の列）をタップしたとき（その日の日表示へ） */
  onDaySelect: (date: string) => void;
};

/**
 * 週表示の縦タイムグリッド（mock-spec.md 2.6）。
 * 7列・7:00〜24:00・1時間＝32px。高さは所要時間に比例させる（design-spec.md 5.4：週表示だけ比例表示）。
 * ブロックには文字を出さず色で種類を表し、高さ24px以上のブロックだけ中央に12pxのアイコンを出す（mock-spec.md 10.22）。
 * ブロックの中身は日表示で見る。押せる範囲はその日の列全体（タップ領域を44px以上にするため）。
 * グリッドの下に凡例を置く。
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
          <button
            key={day.date}
            type="button"
            onClick={() => onDaySelect(day.date)}
            aria-label={columnLabel(day)}
            className={cn(
              "relative min-w-0 flex-1 border-l outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              day.date === today && "bg-(--brand-purple-pale)/30",
            )}
          >
            {day.items.map((item) => (
              <WeekBlock key={item.id} item={item} date={day.date} />
            ))}
          </button>
        ))}
      </div>

      <WeekLegend />
    </div>
  );
}

/** 列のボタンの読み上げ。表示に使っている DayView から、タスクの件数・余白の合計・締切の件数を出す */
function columnLabel(day: DayView): string {
  return formatWeekColumnLabel(formatDateLong(day.date), {
    taskCount: day.items.filter((item) => item.kind === "task").length,
    bufferMinutes: sumMinutesOfKind(day.items, "buffer"),
    deadlineCount: day.deadlines.length,
  });
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

/** 薄い背景＋枠。移動・余白は破線の枠、睡眠は枠なしの薄い灰色、それ以外は左に細い線（丸印の色） */
function blockStyle(appearance: ItemAppearance, isSleep: boolean): CSSProperties {
  if (isSleep) return { backgroundColor: "var(--muted)" };
  if (appearance.dashedBorder) {
    return { backgroundColor: appearance.blockBg, border: `1px dashed ${appearance.circleColor}` };
  }
  return { backgroundColor: appearance.blockBg, borderLeft: `3px solid ${appearance.circleColor}` };
}

/**
 * 1つの予定のブロック。色は design-spec.md 2.3 の薄い背景＋左の細い線（丸印の色）。
 * 移動・余白は破線の枠、睡眠は薄い紫寄りの灰色
 */
function WeekBlock({ item, date }: { item: ScheduleItem; date: string }) {
  const position = blockPosition(item, date);
  if (!position) return null;

  const appearance = getItemAppearance(item.kind, item.fixed_category);
  const isSleep = item.kind === "sleep";
  // 睡眠は凡例に入れないのでアイコンも出さない。移動のアイコンは移動手段で決める（design-spec.md 9.7）
  const showIcon = !isSleep && position.height >= MIN_ICON_HEIGHT;
  // getTravelIcon の戻り値をそのまま <Icon /> にすると react-hooks/static-components に引っかかるため、プロパティ経由で参照する
  const icon = { Icon: item.travel ? getTravelIcon(item.travel.mode) : appearance.icon };

  return (
    <span
      aria-hidden
      className="absolute inset-x-px flex items-center justify-center overflow-hidden rounded-[4px]"
      style={{
        top: position.top + 1,
        height: Math.max(position.height - 2, 2),
        ...blockStyle(appearance, isSleep),
        opacity: item.status === "completed" ? 0.5 : undefined,
      }}
    >
      {showIcon ? <icon.Icon size={12} style={{ color: appearance.circleColor }} /> : null}
    </span>
  );
}

/** 週表示の凡例（mock-spec.md 10.22）。見本のブロックとアイコンと表示名 */
function WeekLegend() {
  return (
    <ul aria-label="凡例" className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 px-1 text-xs text-muted-foreground">
      {WEEK_LEGEND_ITEMS.map(({ label, appearance, icons }) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className="h-4 w-5 shrink-0 rounded-[4px]" style={blockStyle(appearance, false)} aria-hidden />
          {icons.map((Icon, i) => (
            <Icon key={i} size={12} style={{ color: appearance.circleColor }} aria-hidden />
          ))}
          <span className="min-w-0">{label}</span>
        </li>
      ))}
    </ul>
  );
}
