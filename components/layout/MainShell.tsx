import type { ReactNode } from "react";
import { BottomTabBar } from "./BottomTabBar";
import { MobileShell } from "./MobileShell";

type MainShellProps = {
  children: ReactNode;
  /** タブバーの上に固定するページの要素（主ボタン、入力欄など）。省略するとタブバーだけ */
  bottom?: ReactNode;
};

/**
 * 通常利用の画面（/today・/calendar・/replan・/settings）の枠（mock-spec.md 1.2・10.20）。
 * MobileShell の bottom に「ページの固定要素 → BottomTabBar」の順で渡す。
 * (main)/layout.tsx は children を返すだけにし、各ページがこれを使う。
 */
export function MainShell({ children, bottom }: MainShellProps) {
  return (
    <MobileShell
      bottom={
        <>
          {bottom}
          <BottomTabBar />
        </>
      }
    >
      {children}
    </MobileShell>
  );
}
