import type { ReactNode } from "react";

// 通常利用：/today・/calendar・/replan・/settings（mock-spec.md 1.2）
// タブバーの上にページの固定要素（主ボタン・入力欄）を置くため、タブバー付きの枠（MainShell）は各ページで組み立てる（10.20章）。
export default function MainLayout({ children }: { children: ReactNode }) {
  return children;
}
