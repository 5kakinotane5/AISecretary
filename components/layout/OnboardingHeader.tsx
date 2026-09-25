import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type OnboardingHeaderProps = {
  title: string;
  /** タイトルの下の補足（期間など） */
  subtitle?: ReactNode;
  /** 戻るボタンの遷移先。省略すると戻るボタンを出さない */
  backHref?: string;
  /** 進行状況（例：{ current: 3, total: 9 }）。省略すると出さない */
  progress?: { current: number; total: number };
  /** 背景のグラデーション（design-spec.md 2.2・6章）。deep＝航海の準備、header＝航路プランを選ぶ */
  gradient: "deep" | "header";
  className?: string;
};

/**
 * 初回設定（オンボーディング）の画面上部（mock-spec.md 1.2：タブバーなし。上部に戻るボタンと進行状況）。
 * 進行状況バーは紫（design-spec.md 2.0：既定色の青を使わない）。
 */
export function OnboardingHeader({ title, subtitle, backHref, progress, gradient, className }: OnboardingHeaderProps) {
  const ratio = progress ? Math.min(Math.max(progress.current / progress.total, 0), 1) : 0;

  return (
    <header
      className={cn("px-4 pt-3 pb-4 text-white", className)}
      style={{ background: gradient === "deep" ? "var(--gradient-deep)" : "var(--gradient-header)" }}
    >
      <div className="flex min-h-11 items-center gap-1">
        {backHref ? (
          <Link
            href={backHref}
            aria-label="戻る"
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <ChevronLeft size={24} aria-hidden />
          </Link>
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{title}</h1>
        {progress ? (
          <span className="shrink-0 text-sm font-medium tabular-nums opacity-90">
            {progress.current} / {progress.total}
          </span>
        ) : null}
      </div>
      {subtitle ? <p className="mt-1 text-sm opacity-90">{subtitle}</p> : null}
      {progress ? (
        <div
          role="progressbar"
          aria-label="進行状況"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.current}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20"
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${ratio * 100}%`, backgroundColor: "var(--brand-purple-light)" }}
          />
        </div>
      ) : null}
    </header>
  );
}
