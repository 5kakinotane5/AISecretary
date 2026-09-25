import type { ReactNode } from "react";

// 初回設定（オンボーディング）：/login → /interview → /plans（mock-spec.md 1.2）
// タブバーは置かない。下部の固定要素（入力欄・主ボタン）は MobileShell の bottom に渡す決まり（10.16章）のため、
// MobileShell と上部（OnboardingHeader：戻るボタン・進行状況）は各ページで組み立てる。
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return children;
}
