import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  message?: string;
  onRetry?: () => void;
  className?: string;
};

/**
 * 共通のエラー表示（mock-spec.md 1.4：エラー文と「再試行」ボタン）。
 * 赤はエラーの文字とアイコンだけに小さく使う（design-spec.md 2.0）。
 */
export function ErrorState({ message = "読み込みに失敗しました。", onRetry, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-4 py-8 text-center", className)}>
      <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
        <CircleAlert size={16} aria-hidden />
        {message}
      </p>
      {onRetry ? (
        <Button variant="brand-outline" size="tap" onClick={onRetry}>
          <RotateCw aria-hidden />
          再試行
        </Button>
      ) : null}
    </div>
  );
}
