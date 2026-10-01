import type { ReactNode, Ref } from "react";
import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { ItemBlock } from "./ItemBlock";
import { SCREEN_LABELS, TRAVEL_MODE_LABELS, getItemAppearance, getTravelIcon } from "@/lib/labels";
import { diffMinutes, formatTime, formatTimeRange } from "@/lib/datetime";
import { mergeFreeTime } from "@/lib/schedule";
import type { Location, ScheduleItem, Task } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type TimelineProps = {
  /** その日の項目。描画の前に mergeFreeTime で buffer を自由時間として表示し、隣り合う自由時間を1つにまとめる */
  items: ScheduleItem[];
  /** 現在時刻（demo_now）。「現在地」「次の予定」の強調に使う（design-spec.md 9.8） */
  now?: string | null;
  /** 締切バッジと自由時間の候補タスク名を出すためのタスク一覧 */
  tasks?: Task[];
  /** 場所の表示名を出すための場所一覧 */
  locations?: Location[];
  /**
   * 簡略表示。/replan の「変更前と変更後を並べて見る」で2本を左右に並べるときに使う（mock-spec.md 2.5）。
   * 時刻の列と間隔を詰め、ブロックの補足（場所・候補・締切）と移動手段の文字を省く
   */
  compact?: boolean;
  /** 渡すと、タスクと候補タスクのある自由時間のブロックがタップできるようになる（mock-spec.md 2.4） */
  onItemSelect?: (item: ScheduleItem) => void;
  /** 今日のタスク枠の完了状態を切り替える。渡したときだけチェックボタンを表示する */
  onTaskCompletionChange?: (item: ScheduleItem, completed: boolean) => void;
  pendingTaskId?: string | null;
  /** 現在または次の予定へ初期スクロールする */
  autoScrollToHighlight?: boolean;
  /** /today 用。開始・終了時刻の軸と、現在時刻を示す横線を表示する */
  showTimeAxis?: boolean;
  className?: string;
};

type LineStyle = "none" | "solid" | "dashed";

/** 強調する行（design-spec.md 9.8）。now＝現在地、next＝次の予定 */
type Highlight = { itemId: string; kind: "now" | "next" };

const TIME_COL = "w-12";
const TIME_COL_COMPACT = "w-9";
const RAIL_WIDTH = 24;

/** 1行の横並び（簡略表示では時刻の列と間隔を詰める） */
function rowClasses(compact: boolean, showTimeAxis = false): { row: string; timeCol: string } {
  return {
    row: cn("flex items-stretch", compact ? "gap-1.5" : "gap-3"),
    timeCol: cn(compact ? TIME_COL_COMPACT : showTimeAxis ? "w-14" : TIME_COL, "flex shrink-0 items-center justify-end"),
  };
}

/**
 * 今日の予定のタイムライン（design-spec.md 5.4）。
 * 1項目1行のリストで、縦の細い線でつながった丸印を並べる（高さは所要時間に比例させない）。
 * - 移動は丸印を置かず、前後をつなぐ線を点線にして「移動 50分」と小さく表示
 * - 睡眠は1行に折りたたむ
 * - 現在時刻を含む予定の行を「現在地」、該当がなければ次に始まる予定の行を「次の予定」として強調する
 */
export function Timeline({
  items: rawItems,
  now,
  tasks = [],
  locations = [],
  compact = false,
  onItemSelect,
  onTaskCompletionChange,
  pendingTaskId = null,
  autoScrollToHighlight = false,
  showTimeAxis = false,
  className,
}: TimelineProps) {
  const items = mergeFreeTime(rawItems);
  const taskById = new Map(tasks.map((t) => [t.id, t] as const));
  const locationNameById = new Map(locations.map((l) => [l.id, l.name] as const));
  const highlight = now ? findHighlight(items, now) : null;
  const currentItem = now ? items.find((item) => containsTime(item, now)) : undefined;
  const scrollTargetId = currentItem?.id ?? highlight?.itemId ?? null;
  const classes = rowClasses(compact, showTimeAxis);
  const highlightRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (autoScrollToHighlight && scrollTargetId) {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [autoScrollToHighlight, scrollTargetId]);

  const lineBetween = (a: ScheduleItem | undefined, b: ScheduleItem | undefined): LineStyle => {
    if (!a || !b) return "none";
    return a.kind === "travel" || b.kind === "travel" ? "dashed" : "solid";
  };

  return (
    <ol className={cn("flex flex-col", className)}>
      {items.map((item, index) => {
        const top = lineBetween(items[index - 1], item);
        const bottom = lineBetween(item, items[index + 1]);
        const currentPosition = now && currentItem?.id === item.id ? currentPositionPercent(item, now) : null;
        const isScrollTarget = autoScrollToHighlight && scrollTargetId === item.id;

        if (item.kind === "sleep") {
          return (
            <CompactRow
              key={item.id}
              item={item}
              top={top}
              bottom={bottom}
              compact={compact}
              showTimeAxis={showTimeAxis}
              currentPosition={currentPosition}
              currentTime={currentPosition !== null ? now : null}
              rowRef={isScrollTarget ? highlightRef : undefined}
            >
              {item.title} {showTimeAxis ? null : formatTimeRange(item.start_at, item.end_at)}
            </CompactRow>
          );
        }

        if (item.kind === "travel") {
          return (
            <CompactRow
              key={item.id}
              item={item}
              top={top}
              bottom={bottom}
              compact={compact}
              showTimeAxis={showTimeAxis}
              highlight={highlight?.itemId === item.id ? highlight.kind : null}
              currentPosition={currentPosition}
              currentTime={currentPosition !== null ? now : null}
              rowRef={isScrollTarget ? highlightRef : undefined}
            >
              移動 {diffMinutes(item.start_at, item.end_at)}分
              {item.travel && !compact ? `（${TRAVEL_MODE_LABELS[item.travel.mode]}）` : null}
            </CompactRow>
          );
        }

        const selectable = onItemSelect && (item.kind === "task" || (item.kind === "free" && item.suggested_task_ids.length > 0));
        const task = item.task_id ? taskById.get(item.task_id) : undefined;
        const suggestedTitles = item.suggested_task_ids.flatMap((id) => taskById.get(id)?.title ?? []);

        return (
          <li
            key={item.id}
            ref={isScrollTarget ? highlightRef : undefined}
            className={cn(classes.row, "relative gap-1 scroll-mt-28")}
          >
            <div className={classes.timeCol}>
              <TimeLabel
                startAt={item.start_at}
                endAt={item.end_at}
                showEnd={showTimeAxis}
                highlight={highlight?.itemId === item.id ? highlight.kind : null}
              />
            </div>
            <Rail top={top} bottom={bottom}>
              <ItemCircle item={item} />
            </Rail>
            <div className="min-w-0 flex-1 py-1">
              <ItemBlock
                item={item}
                locationName={item.location_id ? (locationNameById.get(item.location_id) ?? null) : null}
                deadlineAt={task?.deadline_at ?? null}
                suggestedTaskTitle={suggestedTitles.length > 0 ? suggestedTitles.join("・") : null}
                compact={compact}
                showTime={!showTimeAxis}
                onSelect={selectable ? () => onItemSelect(item) : undefined}
              />
            </div>
            {item.kind === "task" && onTaskCompletionChange ? (
              <button
                type="button"
                aria-label={item.status === "completed" ? `未完了に戻す：${item.title}` : `完了にする：${item.title}`}
                aria-pressed={item.status === "completed"}
                disabled={pendingTaskId === item.id}
                onClick={() => onTaskCompletionChange(item, item.status !== "completed")}
                className="flex size-11 shrink-0 items-center justify-center rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 items-center justify-center rounded-md border-2",
                    item.status === "completed" ? "border-(--brand-purple) bg-(--brand-purple) text-white" : "border-muted-foreground/50 bg-background",
                  )}
                >
                  {item.status === "completed" ? <Check size={16} strokeWidth={3} /> : null}
                </span>
              </button>
            ) : null}
            {currentPosition !== null && now && showTimeAxis ? <CurrentTimeLine now={now} position={currentPosition} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function containsTime(item: ScheduleItem, isoStr: string): boolean {
  return diffMinutes(item.start_at, isoStr) >= 0 && diffMinutes(isoStr, item.end_at) > 0;
}

function currentPositionPercent(item: ScheduleItem, now: string): number {
  const duration = diffMinutes(item.start_at, item.end_at);
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (diffMinutes(item.start_at, now) / duration) * 100));
}

/**
 * 現在時刻を含む予定（移動を含む）があれば「現在地」。
 * 睡眠中や予定の間の隙間で該当がなければ、次に始まる予定を「次の予定」にする。睡眠は対象にしない。
 */
function findHighlight(items: ScheduleItem[], now: string): Highlight | null {
  const candidates = items.filter((item) => item.kind !== "sleep");
  const current = candidates.find((item) => containsTime(item, now));
  if (current) return { itemId: current.id, kind: "now" };
  const next = candidates.find((item) => diffMinutes(now, item.start_at) > 0);
  return next ? { itemId: next.id, kind: "next" } : null;
}

function highlightLabel(kind: Highlight["kind"]): string {
  return kind === "now" ? SCREEN_LABELS.currentTimeLine : SCREEN_LABELS.nextRoute;
}

/** 睡眠・移動の1行（丸印を置かず、小さなアイコンと文字だけ） */
function CompactRow({
  item,
  top,
  bottom,
  highlight = null,
  compact,
  showTimeAxis = false,
  currentPosition = null,
  currentTime = null,
  rowRef,
  children,
}: {
  item: ScheduleItem;
  top: LineStyle;
  bottom: LineStyle;
  highlight?: Highlight["kind"] | null;
  compact: boolean;
  showTimeAxis?: boolean;
  currentPosition?: number | null;
  currentTime?: string | null;
  rowRef?: Ref<HTMLLIElement>;
  children: ReactNode;
}) {
  const appearance = getItemAppearance(item.kind, item.fixed_category);
  // getTravelIcon の戻り値をそのまま <Icon /> にすると react-hooks/static-components に
  // 引っかかるため、プロパティ経由で参照する
  const icon = { Icon: item.travel ? getTravelIcon(item.travel.mode) : appearance.icon };
  const classes = rowClasses(compact, showTimeAxis);

  return (
    <li ref={rowRef} className={cn(classes.row, "relative min-h-10 scroll-mt-28")}>
      <div className={classes.timeCol}>
        {showTimeAxis ? (
          <TimeLabel startAt={item.start_at} endAt={item.end_at} showEnd highlight={highlight} />
        ) : highlight ? (
          <HighlightText kind={highlight} />
        ) : null}
      </div>
      <Rail top={top} bottom={bottom} />
      <div className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 py-1 text-xs text-muted-foreground">
        <icon.Icon size={14} style={{ color: appearance.iconColor }} aria-hidden />
        <span className="tabular-nums">{children}</span>
      </div>
      {currentPosition !== null && currentTime && showTimeAxis ? <CurrentTimeLine now={currentTime} position={currentPosition} /> : null}
    </li>
  );
}

/** 丸印の列。上下半分ずつ線を引き、前後の行の線とつなげる */
function Rail({ top, bottom, children }: { top: LineStyle; bottom: LineStyle; children?: ReactNode }) {
  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: RAIL_WIDTH }}>
      <RailLine style={top} position="top" />
      <RailLine style={bottom} position="bottom" />
      {children ? <div className="relative">{children}</div> : null}
    </div>
  );
}

function RailLine({ style, position }: { style: LineStyle; position: "top" | "bottom" }) {
  if (style === "none") return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute left-1/2 h-1/2 -translate-x-1/2 border-l-2",
        position === "top" ? "top-0" : "bottom-0",
        style === "dashed" && "border-dotted",
      )}
      style={{ borderColor: style === "dashed" ? "var(--kind-travel)" : "var(--purple-gray-light)" }}
    />
  );
}

/** 丸印（直径24px。design-spec.md 5.4）。塗りに白いアイコン（circleStyle が ring のときだけ破線の輪） */
function ItemCircle({ item }: { item: ScheduleItem }) {
  const appearance = getItemAppearance(item.kind, item.fixed_category);
  const Icon = appearance.icon;
  return (
    <span
      className="flex size-6 items-center justify-center rounded-full"
      style={
        appearance.circleStyle === "filled"
          ? { backgroundColor: appearance.circleColor }
          : { border: `2px dashed ${appearance.circleColor}`, backgroundColor: "var(--surface)" }
      }
    >
      <Icon size={14} style={{ color: appearance.iconColor }} aria-hidden />
    </span>
  );
}

/** 強調の枠（--brand-purple-pale の角丸。design-spec.md 5.4） */
function HighlightChip({ children }: { children: ReactNode }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums"
      style={{ backgroundColor: "var(--brand-purple-pale)" }}
    >
      {children}
    </span>
  );
}

/** 「現在地」「次の予定」の小さな紫の文字 */
function HighlightText({ kind }: { kind: Highlight["kind"] }) {
  return (
    <span className="text-[10px] leading-none font-bold whitespace-nowrap" style={{ color: "var(--brand-purple)" }}>
      {highlightLabel(kind)}
    </span>
  );
}

/** 左の時刻軸。/todayでは開始と終了を上下に並べ、予定の長さを読み取りやすくする。 */
function TimeLabel({
  startAt,
  endAt,
  showEnd,
  highlight,
}: {
  startAt: string;
  endAt: string;
  showEnd: boolean;
  highlight: Highlight["kind"] | null;
}) {
  if (!showEnd) {
    if (highlight) {
      return (
        <span className="flex flex-col items-end gap-0.5">
          <HighlightChip>{formatTime(startAt)}</HighlightChip>
          <HighlightText kind={highlight} />
        </span>
      );
    }
    return <span className="text-xs font-medium text-muted-foreground tabular-nums">{formatTime(startAt)}</span>;
  }

  return (
    <span className="flex h-full min-h-11 flex-col items-end justify-between py-1 text-[11px] leading-none font-medium text-muted-foreground tabular-nums">
      <span>{formatTime(startAt)}</span>
      {highlight ? <HighlightText kind={highlight} /> : <span aria-hidden className="h-px w-2 bg-(--purple-gray-light)" />}
      <span>{formatTime(endAt)}</span>
    </span>
  );
}

/** 現在時刻を正確な位置に示す横線。予定の種類の色とは競合しないブランド紫を使う。 */
function CurrentTimeLine({ now, position }: { now: string; position: number }) {
  return (
    <div
      aria-label={`現在時刻 ${formatTime(now)}`}
      className="pointer-events-none absolute inset-x-0 z-10 flex -translate-y-1/2 items-center gap-1"
      style={{ top: `${position}%` }}
    >
      <span className="w-14 shrink-0 rounded-full bg-(--brand-purple) px-1.5 py-1 text-center text-[10px] leading-none font-bold text-white tabular-nums shadow-sm">
        {formatTime(now)}
      </span>
      <span className="relative h-0 flex-1 border-t-2 border-(--brand-purple)">
        <span className="absolute -top-1.25 -left-1 size-2 rounded-full bg-(--brand-purple)" />
      </span>
    </div>
  );
}
