"use client";

import type { ReactNode } from "react";
import { DeadlineBadge } from "./DeadlineBadge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getItemAppearance } from "@/lib/labels";
import { formatTimeRange } from "@/lib/datetime";
import { suggestedTaskIdsOf } from "@/lib/schedule";
import type { ScheduleItem, Task } from "@/lib/schemas";

type ItemDetailSheetProps = {
  /** 表示する項目。閉じるアニメーションの間も中身を残すため、open とは別に渡す */
  item: ScheduleItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 締切と自由時間の候補タスク名を引くためのタスク一覧 */
  tasks?: Task[];
  /** 場所の表示名。不明なら null */
  locationName?: string | null;
};

/**
 * タスク・候補のある自由時間をタップしたときの詳細（mock-spec.md 2.4・10.9：shadcn の Sheet の side="bottom"）。
 * タイトル、時間、場所、締切、自由時間の候補タスク、この時間に入れた理由を出す。値がない項目の行は出さない。
 */
export function ItemDetailSheet({ item, open, onOpenChange, tasks = [], locationName = null }: ItemDetailSheetProps) {
  const task = item?.task_id ? tasks.find((t) => t.id === item.task_id) : undefined;
  // Timeline でまとめた自由時間は候補を複数持つことがある（lib/schedule.ts の mergeFreeTime）
  const suggestedTitles = item ? suggestedTaskIdsOf(item).flatMap((id) => tasks.find((t) => t.id === id)?.title ?? []) : [];
  // 内部の「バッファ」は画面上「自由時間」と表示する（design-spec.md 4章）
  const title = item ? (item.kind === "buffer" ? getItemAppearance(item.kind).label : item.title) : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        // 背景はぼかさず、--brand-dark の30%で暗くして後ろの画面をうっすら見せる（mock-spec.md 10.21）
        overlayClassName="bg-(--brand-dark)/30 supports-backdrop-filter:backdrop-blur-none"
        className="mx-auto max-h-[85dvh] w-full max-w-[430px] overflow-y-auto rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {item ? (
          <>
            <SheetHeader className="px-5 pt-6 pb-0">
              <SheetTitle className="text-lg font-bold">{title}</SheetTitle>
              <SheetDescription className="tabular-nums">{formatTimeRange(item.start_at, item.end_at)}</SheetDescription>
            </SheetHeader>

            <dl className="flex flex-col gap-3 px-5 text-sm">
              {locationName ? <DetailRow label="場所">{locationName}</DetailRow> : null}
              {task?.deadline_at ? (
                <DetailRow label="締切">
                  <DeadlineBadge deadlineAt={task.deadline_at} size="md" />
                </DetailRow>
              ) : null}
              {suggestedTitles.length > 0 ? <DetailRow label="候補">{suggestedTitles.join("・")}</DetailRow> : null}
              {/* まとめた自由時間の理由は改行でつないである */}
              {item.reason ? (
                <DetailRow label="この時間に入れた理由">
                  <span className="whitespace-pre-line">{item.reason}</span>
                </DetailRow>
              ) : null}
            </dl>

            <div className="px-5 pt-2">
              <SheetClose render={<Button variant="brand-outline" size="cta" />}>閉じる</SheetClose>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
