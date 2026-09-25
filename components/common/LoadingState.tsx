import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type LoadingStateProps = {
  /** 「スケジュールを作成しています…」など。時間のかかる処理のときだけ付ける（mock-spec.md 1.4） */
  message?: string;
  /** スケルトンの行数 */
  rows?: number;
  className?: string;
};

/** 共通のローディング表示（mock-spec.md 1.4：shadcn の Skeleton） */
export function LoadingState({ message, rows = 4, className }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col gap-3", className)}>
      {message ? (
        <p className="text-center text-sm font-medium" style={{ color: "var(--brand-purple)" }}>
          {message}
        </p>
      ) : (
        <span className="sr-only">読み込み中…</span>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-10 rounded-full" />
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <Skeleton className="h-11 flex-1 rounded-2xl" />
        </div>
      ))}
    </div>
  );
}
