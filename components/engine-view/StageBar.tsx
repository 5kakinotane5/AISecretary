"use client";

import { Check } from "lucide-react";
import { formatMonthDay, formatTime } from "@/lib/datetime";
import { STAGES, type TurnView } from "@/lib/engine-view/view-state";
import { cn } from "@/lib/utils";

// 上段：入力と処理の段階（チェックインと会話で段階の並びを変える）

export function StageBar({ turn }: { turn: TurnView }) {
  const stages = STAGES[turn.source];
  const input = turn.source === "checkin" ? `今日の調子「${turn.text}」` : `「${turn.text}」`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-4">
        <span className="shrink-0 font-bold text-muted-foreground">入力</span>
        <span className="min-w-0 flex-1 truncate text-lg font-bold">{input}</span>
        <span className="shrink-0 tabular-nums">
          {formatMonthDay(turn.now)} {formatTime(turn.now)}
        </span>
        <span className="w-[5em] shrink-0 text-right tabular-nums">{(turn.elapsedMs / 1000).toFixed(1)} 秒</span>
      </div>
      <ol className="flex items-center gap-2">
        {stages.map((label, i) => {
          const passed = i < turn.stage || (turn.done && i === turn.stage);
          const current = i === turn.stage && !turn.done;
          return (
            <li key={label} className="flex items-center gap-2">
              {i > 0 ? <span className={cn("h-0.5 w-8 rounded-full", i <= turn.stage ? "bg-[var(--brand-purple)]" : "bg-[var(--border)]")} /> : null}
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors duration-500",
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
    </div>
  );
}
