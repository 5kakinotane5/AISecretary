import { Flag } from "lucide-react";
import { DEADLINE_BADGE_BG, DEADLINE_BADGE_TEXT_COLOR, formatDeadlineBadge } from "@/lib/labels";
import { cn } from "@/lib/utils";

type DeadlineBadgeProps = {
  deadlineAt: string;
  size?: "sm" | "md";
  className?: string;
};

/** 締切バッジ「締切 10/9」（design-spec.md 5.4・9.3。赤は使わない） */
export function DeadlineBadge({ deadlineAt, size = "sm", className }: DeadlineBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-xl font-medium",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1.5 text-sm",
        className,
      )}
      style={{ backgroundColor: DEADLINE_BADGE_BG, color: DEADLINE_BADGE_TEXT_COLOR }}
    >
      <Flag size={size === "sm" ? 12 : 16} aria-hidden />
      {formatDeadlineBadge(deadlineAt)}
    </span>
  );
}
