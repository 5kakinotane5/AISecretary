import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type MobileShellProps = {
  children: ReactNode;
  /** 下部にタブバーを置く画面は true。タブバーの高さ分、本文の下に余白をとる */
  withTabBar?: boolean;
  className?: string;
};

/**
 * スマホの枠（mock-spec.md 1.1、design-spec.md 5.1）。
 * PCで開いたときは幅430pxまでの枠を中央に置き、枠の外は --brand-bg にごく薄い紫のぼかしを重ねる。
 */
export function MobileShell({ children, withTabBar = false, className }: MobileShellProps) {
  return (
    <div
      className="flex min-h-dvh w-full justify-center"
      style={{
        backgroundColor: "var(--brand-bg)",
        backgroundImage: "var(--shell-backdrop)",
        backgroundAttachment: "fixed",
      }}
    >
      <div
        className={cn(
          "relative flex min-h-dvh w-full max-w-[430px] flex-col bg-background md:shadow-card",
          withTabBar && "pb-[calc(64px+env(safe-area-inset-bottom))]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
