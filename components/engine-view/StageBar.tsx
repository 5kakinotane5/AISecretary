"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { formatMonthDay, formatTime } from "@/lib/datetime";
import { STAGES, type TurnView } from "@/lib/engine-view/view-state";
import { cn } from "@/lib/utils";

// 上段：見出し・処理の段階・接続の状態（1行目）と、入力・時刻（2行目）。
// 段階の並びはチェックインと会話で変える

function Stages({ turn }: { turn: TurnView }) {
  return (
    <ol className="flex items-center gap-1.5">
      {STAGES[turn.source].map((label, i) => {
        const passed = i < turn.stage || (turn.done && i === turn.stage);
        const current = i === turn.stage && !turn.done;
        return (
          <li key={label} className="flex items-center gap-1.5">
            {i > 0 ? <span className={cn("h-0.5 w-5 rounded-full", i <= turn.stage ? "bg-[var(--brand-purple)]" : "bg-[var(--border)]")} /> : null}
            <span
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-0.5 whitespace-nowrap transition-colors duration-500",
                passed && "border-[var(--brand-purple)] bg-[var(--brand-purple)] text-white",
                current && "animate-pulse border-[var(--brand-purple)] bg-[var(--brand-purple-pale)] font-bold text-[var(--deadline-fg)]",
                !passed && !current && "text-muted-foreground",
              )}
            >
              {passed ? <Check size={16} aria-hidden /> : null}
              {label}
              {label === "案を検査" && turn.options.length > 0 ? `（${turn.options.length}）` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function TopBar({ turn, badge, children }: { turn: TurnView | null; badge: ReactNode; children?: ReactNode }) {
  return (
    <SurfaceCard className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-4">
        <h1 className="shrink-0 text-xl font-bold">エンジンビュー</h1>
        {turn ? <Stages turn={turn} /> : null}
        <span className="ml-auto shrink-0">{badge}</span>
      </div>
      {turn ? (
        <div className="flex items-baseline gap-4">
          <span className="shrink-0 font-bold text-muted-foreground">入力</span>
          <span className="min-w-0 flex-1 truncate text-lg font-bold">
            {turn.source === "checkin" ? `今日の調子「${turn.text}」` : `「${turn.text}」`}
          </span>
          <span className="shrink-0 tabular-nums">
            {formatMonthDay(turn.now)} {formatTime(turn.now)}
          </span>
          <span className="w-[5em] shrink-0 text-right tabular-nums">{(turn.elapsedMs / 1000).toFixed(1)} 秒</span>
        </div>
      ) : null}
      {children}
    </SurfaceCard>
  );
}
