"use client";

import { useEffect, useRef, useState } from "react";

// 別画面の動き（パッケージを使わず requestAnimationFrame で動かす）

export const TWEEN_MS = 600;
// 変化を目立たせる時間
export const HIGHLIGHT_MS = 2000;
// これより小さい変化は「変化なし」として扱う
const EPSILON = 0.005;

const sameValues = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) < 1e-9);

// 前の値から新しい値へ ms かけて動かした値（数値の並び。レーダーの多角形にも使う）
export function useTweenArray(target: readonly number[], ms: number = TWEEN_MS): number[] {
  const key = target.join(",");
  const [shown, setShown] = useState<number[]>(() => [...target]);
  const shownRef = useRef<number[]>([...target]);

  useEffect(() => {
    const to = key === "" ? [] : key.split(",").map(Number);
    const from = shownRef.current;
    if (sameValues(from, to)) return;
    const startedAt = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / ms);
      const eased = 1 - (1 - progress) ** 3;
      const next = to.map((value, i) => {
        const start = from[i] ?? value;
        return start + (value - start) * eased;
      });
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, ms]);

  return shown;
}

export function useTween(target: number, ms: number = TWEEN_MS): number {
  return useTweenArray([target], ms)[0] ?? target;
}

// 値が変わったときの差分。hot は変わってから HIGHLIGHT_MS の間だけ true。
// resetKey（ターンの id）が変わって値が同じなら、差分を消す
export function useChange(value: number | null, resetKey: string): { delta: number | null; hot: boolean } {
  const [previous, setPrevious] = useState({ value, resetKey });
  const [delta, setDelta] = useState<number | null>(null);
  const [hot, setHot] = useState(false);
  const [stamp, setStamp] = useState(0);

  if (previous.value !== value || previous.resetKey !== resetKey) {
    setPrevious({ value, resetKey });
    const moved = value !== null && previous.value !== null && Math.abs(value - previous.value) >= EPSILON;
    if (moved) {
      setDelta(value - (previous.value as number));
      setHot(true);
      setStamp((n) => n + 1);
    } else if (previous.resetKey !== resetKey) {
      setDelta(null);
      setHot(false);
    }
  }

  useEffect(() => {
    if (stamp === 0) return;
    const timer = window.setTimeout(() => setHot(false), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [stamp]);

  return { delta, hot };
}
