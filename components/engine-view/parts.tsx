"use client";

import type { ReactNode } from "react";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { cn } from "@/lib/utils";
import { useChange, useTween } from "./motion";

// 別画面の共通の部品（数値・差分・棒・パネル）

// 増加・減少の色（白の上で読める濃さ。空き時間の緑・固定予定の橙を濃くしたもの。赤は使わない）
export const UP_COLOR = "#0f7a5f";
export const DOWN_COLOR = "#b4531f";

export const formatValue = (value: number, digits = 2) => value.toFixed(digits);

// 値を数字で出す（600ms でカウントアップ）
export function AnimatedNumber({ value, digits = 2, className }: { value: number; digits?: number; className?: string }) {
  const shown = useTween(value);
  return <span className={cn("tabular-nums", className)}>{formatValue(shown, digits)}</span>;
}

// 差分（↑ +0.15 / ↓ −0.10）。変わってから2秒は色の背景で目立たせ、その後は文字だけにする
// compact：幅を取らない（表のセルの中で使う）
export function Delta({
  value,
  resetKey,
  digits = 2,
  compact = false,
}: {
  value: number | null;
  resetKey: string;
  digits?: number;
  compact?: boolean;
}) {
  const { delta, hot } = useChange(value, resetKey);
  if (delta === null) return compact ? null : <span className="inline-block w-[5.5em]" aria-hidden />;
  const up = delta > 0;
  const color = up ? UP_COLOR : DOWN_COLOR;
  return (
    <span
      className={cn(
        "inline-block rounded-md px-0.5 text-right font-bold tabular-nums whitespace-nowrap transition-[background-color,opacity] duration-700",
        hot ? "opacity-100" : "opacity-70",
        compact ? "" : "w-[5.5em]",
      )}
      style={{ color, backgroundColor: hot ? (up ? "#dff5ee" : "#fde8dc") : "transparent" }}
    >
      {up ? "↑+" : "↓−"}
      {formatValue(Math.abs(delta), digits)}
    </span>
  );
}

// 0〜1 の棒（長さは CSS の transition で 600ms）
export function Bar({ value, color = "var(--brand-purple)", className }: { value: number; color?: string; className?: string }) {
  const width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  return (
    <span className={cn("block h-2.5 overflow-hidden rounded-full bg-[var(--muted)]", className)}>
      <span className="block h-full rounded-full transition-[width] duration-[600ms] ease-out" style={{ width, backgroundColor: color }} />
    </span>
  );
}

export function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <SurfaceCard className={cn("flex flex-col gap-3", className)}>
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </SurfaceCard>
  );
}
