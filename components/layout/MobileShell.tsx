import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type MobileShellProps = {
  /** 列の中でスクロールする本文 */
  children: ReactNode;
  /**
   * 列の下端に固定するもの（タブバー、入力欄、主ボタンなど）。上から順に並べる。
   * 画面下部の固定要素は position: fixed を使わず、ここに渡す（列の下端に固定されるようにするため）。
   */
  bottom?: ReactNode;
  className?: string;
};

/**
 * アプリの表示領域（mock-spec.md 1.1・10.16、design-spec.md 5.1・9.11）。
 * スマホの枠（390×844・角丸・縁取り・影）は出さない。デモは Chrome の開発者ツールのスマホ表示で見せる。
 * - 画面幅が広いときは、幅430pxまでの列を中央に置く。列の外は --brand-bg に紫のぼかしを重ねる
 * - 本文は列の中だけでスクロールし、bottom は列の下端に固定される
 */
export function MobileShell({ children, bottom, className }: MobileShellProps) {
  return (
    <div
      className="min-h-dvh w-full"
      style={{ backgroundColor: "var(--brand-bg)", backgroundImage: "var(--shell-backdrop)" }}
    >
      <div className={cn("mx-auto flex h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-background", className)}>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {bottom ? <div className="shrink-0">{bottom}</div> : null}
      </div>
    </div>
  );
}
