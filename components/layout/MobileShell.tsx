import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type MobileShellProps = {
  /** 枠の中でスクロールする本文 */
  children: ReactNode;
  /**
   * 枠の下端に固定するもの（タブバー、入力欄、主ボタンなど）。上から順に並べる。
   * 画面下部の固定要素は position: fixed を使わず、ここに渡す（枠の下端に固定されるようにするため）。
   */
  bottom?: ReactNode;
  className?: string;
};

/**
 * スマホの枠（mock-spec.md 1.1・10.16、design-spec.md 5.1）。
 * - 画面幅640px以上：幅390px・高さ844pxの枠を画面中央に置く。角丸40px、--brand-dark の縁取りと影。
 *   枠の外は --brand-bg に紫のぼかしを重ねる
 * - 640px未満（実際のスマホ）：枠を出さず、画面いっぱいに表示する
 * - どちらも、本文は枠（画面）の中だけでスクロールし、bottom は下端に固定される
 */
export function MobileShell({ children, bottom, className }: MobileShellProps) {
  return (
    <div
      className="min-h-dvh w-full sm:flex sm:items-center sm:justify-center sm:p-6"
      style={{ backgroundColor: "var(--brand-bg)", backgroundImage: "var(--shell-backdrop)" }}
    >
      <div
        className={cn(
          "flex h-dvh w-full flex-col overflow-hidden bg-background",
          // 縁取りは box-content で外側に付け、中の表示領域を 390×844 に保つ
          "sm:box-content sm:h-[844px] sm:max-h-[calc(100dvh-3rem-20px)] sm:w-[390px] sm:rounded-[40px] sm:border-[10px] sm:border-[var(--brand-dark)] sm:shadow-[var(--shadow-frame)]",
          className,
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {bottom ? <div className="shrink-0">{bottom}</div> : null}
      </div>
    </div>
  );
}
