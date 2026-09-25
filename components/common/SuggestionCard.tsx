import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { SurfaceCard } from "./SurfaceCard";
import { cn } from "@/lib/utils";

type SuggestionCardProps = {
  icon: ComponentType<LucideProps>;
  /** 左の丸いアイコンの背景（パステル色）とアイコンの色。CSS変数で渡す（例："var(--kind-task-bg)"） */
  iconBg?: string;
  iconColor?: string;
  title: ReactNode;
  /** タイトルの下の補足（小さい灰色の文字） */
  description?: ReactNode;
  /** 右端に置くもの（時間の数字など） */
  trailing?: ReactNode;
  /** カードの下側に置くもの（詳しい説明やボタン） */
  children?: ReactNode;
  className?: string;
};

/**
 * おすすめ・候補カード（design-spec.md 5.6：「今日のおすすめ航路」）。
 * 白いカードに、左にパステル色の丸いアイコン、右にタイトル（太字）と補足。
 * 目標時間3案（/interview）、再計画の変更点（/replan）、航路プランの比較（/plans）で使う。
 */
export function SuggestionCard({
  icon: Icon,
  iconBg = "var(--brand-purple-pale)",
  iconColor = "var(--brand-purple)",
  title,
  description,
  trailing,
  children,
  className,
}: SuggestionCardProps) {
  return (
    <SurfaceCard className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: iconBg }}
        >
          <Icon size={20} style={{ color: iconColor }} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">{title}</p>
          {description ? <div className="mt-0.5 text-xs text-muted-foreground">{description}</div> : null}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {children}
    </SurfaceCard>
  );
}
