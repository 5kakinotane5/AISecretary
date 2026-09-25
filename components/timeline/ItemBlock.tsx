import { Check, Lock } from "lucide-react";
import { DeadlineBadge } from "./DeadlineBadge";
import { getItemAppearance } from "@/lib/labels";
import { formatTimeRange } from "@/lib/datetime";
import type { ScheduleItem } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type ItemBlockProps = {
  item: ScheduleItem;
  /** 場所の表示名（location_id から引いたもの）。不明なら null */
  locationName?: string | null;
  /** タスクの締切（task_id から引いたもの）。締切がなければ null */
  deadlineAt?: string | null;
  /** バッファの候補タスク名（suggested_task_id から引いたもの） */
  suggestedTaskTitle?: string | null;
  /** 渡すとタップできるブロックになる（タスク・バッファの詳細シートを開く） */
  onSelect?: () => void;
};

/**
 * タイムラインの1項目の右側（タイトルと補足）。design-spec.md 2.3・5.4、mock-spec.md 1.3。
 * 睡眠・移動は Timeline 側で1行に折りたたむため、ここでは扱わない。
 */
export function ItemBlock({ item, locationName, deadlineAt, suggestedTaskTitle, onSelect }: ItemBlockProps) {
  const appearance = getItemAppearance(item.kind, item.fixed_category);
  const completed = item.status === "completed";
  // 内部の「バッファ」は画面上「余白」と表示する（design-spec.md 4章）
  const title = item.kind === "buffer" ? appearance.label : item.title;

  const body = (
    <>
      <div className="flex items-center gap-1.5">
        {completed ? <Check size={14} className="shrink-0 text-primary" aria-label="完了" /> : null}
        <p className={cn("min-w-0 flex-1 truncate text-sm font-bold", completed && "line-through decoration-1")}>
          {title}
        </p>
        {item.locked ? <Lock size={12} className="shrink-0 text-muted-foreground" aria-label="固定" /> : null}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatTimeRange(item.start_at, item.end_at)}</span>
        {locationName ? <span className="max-w-full truncate">{locationName}</span> : null}
        {suggestedTaskTitle ? <span>候補：{suggestedTaskTitle}</span> : null}
        {deadlineAt ? <DeadlineBadge deadlineAt={deadlineAt} /> : null}
      </div>
    </>
  );

  const className = cn(
    "block min-h-11 w-full min-w-0 rounded-2xl px-3 py-2 text-left",
    completed && "opacity-50",
    onSelect && "outline-none transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50",
  );
  const style = {
    backgroundColor: appearance.blockBg,
    border: appearance.dashedBorder ? "1px dashed var(--purple-gray-light)" : undefined,
    // タスクは主役として左に紫の線（design-spec.md 2.3）
    borderLeft: item.kind === "task" ? `3px solid ${appearance.circleColor}` : undefined,
  };

  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className={className} style={style}>
        {body}
      </button>
    );
  }
  return (
    <div className={className} style={style}>
      {body}
    </div>
  );
}
