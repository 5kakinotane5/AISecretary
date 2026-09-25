import type { ReactNode } from "react";
import { CompassMark } from "@/components/brand/CompassMark";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  /** 「この日の計画はまだありません」など、状況に合った一文（mock-spec.md 1.4） */
  message: string;
  /** 「スケジュールを作成」などの導線を置くとき */
  action?: ReactNode;
  className?: string;
};

/** 共通の空の表示（mock-spec.md 1.4） */
export function EmptyState({ message, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 py-8 text-center", className)}>
      <CompassMark size={40} className="opacity-60" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}
