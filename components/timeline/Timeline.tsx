import type { ReactNode } from "react";
import { ItemBlock } from "./ItemBlock";
import { SCREEN_LABELS, getItemAppearance, getTravelIcon } from "@/lib/labels";
import { diffMinutes, formatTime, formatTimeRange } from "@/lib/datetime";
import type { Location, ScheduleItem, Task } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type TimelineProps = {
  /** その日の項目（開始時刻順） */
  items: ScheduleItem[];
  /** 現在時刻（demo_now）。その時刻を含む項目の時刻を「現在地」として強調する */
  now?: string | null;
  /** 締切バッジとバッファの候補タスク名を出すためのタスク一覧 */
  tasks?: Task[];
  /** 場所の表示名を出すための場所一覧 */
  locations?: Location[];
  /** 渡すと、タスクとバッファのブロックがタップできるようになる（mock-spec.md 2.4） */
  onItemSelect?: (item: ScheduleItem) => void;
  className?: string;
};

type LineStyle = "none" | "solid" | "dashed";

const TIME_COL = "w-12";
const RAIL_WIDTH = 24;

/**
 * 今日の航路のタイムライン（design-spec.md 5.4）。
 * 1項目1行のリストで、縦の細い線でつながった丸印を並べる（高さは所要時間に比例させない）。
 * - 移動は丸印を置かず、前後をつなぐ線を点線にして「移動 50分」と小さく表示
 * - 睡眠は1行に折りたたむ
 */
export function Timeline({ items, now, tasks = [], locations = [], onItemSelect, className }: TimelineProps) {
  const taskById = new Map(tasks.map((t) => [t.id, t] as const));
  const locationNameById = new Map(locations.map((l) => [l.id, l.name] as const));
  const nowItemId = now ? items.find((item) => containsTime(item, now))?.id : undefined;

  const lineBetween = (a: ScheduleItem | undefined, b: ScheduleItem | undefined): LineStyle => {
    if (!a || !b) return "none";
    return a.kind === "travel" || b.kind === "travel" ? "dashed" : "solid";
  };

  return (
    <ol className={cn("flex flex-col", className)}>
      {items.map((item, index) => {
        const top = lineBetween(items[index - 1], item);
        const bottom = lineBetween(item, items[index + 1]);

        if (item.kind === "sleep") {
          return (
            <CompactRow key={item.id} item={item} top={top} bottom={bottom}>
              {item.title} {formatTimeRange(item.start_at, item.end_at)}
            </CompactRow>
          );
        }

        if (item.kind === "travel") {
          return (
            <CompactRow key={item.id} item={item} top={top} bottom={bottom}>
              移動 {diffMinutes(item.start_at, item.end_at)}分
            </CompactRow>
          );
        }

        const selectable = onItemSelect && (item.kind === "task" || item.kind === "buffer");
        const task = item.task_id ? taskById.get(item.task_id) : undefined;
        const suggested = item.suggested_task_id ? taskById.get(item.suggested_task_id) : undefined;

        return (
          <li key={item.id} className="flex items-stretch gap-3">
            <div className={cn(TIME_COL, "flex shrink-0 items-center justify-end")}>
              <TimeLabel isoStr={item.start_at} isNow={item.id === nowItemId} />
            </div>
            <Rail top={top} bottom={bottom}>
              <ItemCircle item={item} />
            </Rail>
            <div className="min-w-0 flex-1 py-1">
              <ItemBlock
                item={item}
                locationName={item.location_id ? (locationNameById.get(item.location_id) ?? null) : null}
                deadlineAt={task?.deadline_at ?? null}
                suggestedTaskTitle={suggested?.title ?? null}
                onSelect={selectable ? () => onItemSelect(item) : undefined}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function containsTime(item: ScheduleItem, isoStr: string): boolean {
  return diffMinutes(item.start_at, isoStr) >= 0 && diffMinutes(isoStr, item.end_at) > 0;
}

/** 睡眠・移動の1行（丸印を置かず、小さなアイコンと文字だけ） */
function CompactRow({
  item,
  top,
  bottom,
  children,
}: {
  item: ScheduleItem;
  top: LineStyle;
  bottom: LineStyle;
  children: ReactNode;
}) {
  const appearance = getItemAppearance(item.kind, item.fixed_category);
  // getTravelIcon の戻り値をそのまま <Icon /> にすると react-hooks/static-components に
  // 引っかかるため、プロパティ経由で参照する
  const icon = { Icon: item.travel ? getTravelIcon(item.travel.mode) : appearance.icon };

  return (
    <li className="flex items-stretch gap-3">
      <div className={cn(TIME_COL, "shrink-0")} />
      <Rail top={top} bottom={bottom} />
      <div className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 py-1 text-xs text-muted-foreground">
        <icon.Icon size={14} style={{ color: appearance.iconColor }} aria-hidden />
        <span className="tabular-nums">{children}</span>
      </div>
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

/** 丸印（直径24px。design-spec.md 5.4）。余白は破線の輪、それ以外は塗りに白いアイコン */
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

/** 左の時刻。現在時刻の行は --brand-purple-pale の角丸の枠で囲む（design-spec.md 5.4） */
function TimeLabel({ isoStr, isNow }: { isoStr: string; isNow: boolean }) {
  if (isNow) {
    return (
      <span className="rounded-full px-2 py-0.5 text-xs font-medium tabular-nums" style={{ backgroundColor: "var(--brand-purple-pale)" }}>
        <span className="sr-only">{SCREEN_LABELS.currentTimeLine} </span>
        {formatTime(isoStr)}
      </span>
    );
  }
  return <span className="text-xs font-medium text-muted-foreground tabular-nums">{formatTime(isoStr)}</span>;
}
