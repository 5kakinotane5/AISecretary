"use client";

import { useEffect, useRef } from "react";
import type { LogLine } from "@/lib/engine-view/view-state";

// 下段：届いた出来事のログ（新しいものが下。いつも一番下を見せる）

export function LogPanel({ log }: { log: LogLine[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [log]);
  return (
    <ol ref={listRef} className="flex h-40 flex-col gap-0.5 overflow-y-auto">
      {log.map((line) => (
        <li key={line.seq} className="flex gap-3">
          <span className="w-[4.5em] shrink-0 text-right tabular-nums text-muted-foreground">+{(line.tMs / 1000).toFixed(1)}s</span>
          <span className="min-w-0">{line.text}</span>
        </li>
      ))}
    </ol>
  );
}
