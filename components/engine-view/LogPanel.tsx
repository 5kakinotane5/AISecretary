"use client";

import { useEffect, useRef } from "react";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import type { LogLine } from "@/lib/engine-view/view-state";

// 下段：届いた出来事のログ。高さは4行分で、パネルの中でスクロールする（新しいものが下。いつも一番下を見せる）

export function LogPanel({ log }: { log: LogLine[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [log]);
  return (
    <SurfaceCard className="flex gap-4 py-3">
      <h2 className="shrink-0 text-lg font-bold">ログ</h2>
      <ol ref={listRef} className="flex h-24 min-w-0 flex-1 flex-col overflow-y-auto leading-6">
        {log.map((line) => (
          <li key={line.seq} className="flex gap-3">
            <span className="w-[4.5em] shrink-0 text-right tabular-nums text-muted-foreground">+{(line.tMs / 1000).toFixed(1)}s</span>
            <span className="min-w-0 truncate">{line.text}</span>
          </li>
        ))}
      </ol>
    </SurfaceCard>
  );
}
