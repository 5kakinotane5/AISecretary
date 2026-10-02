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

export const isMoved = (a: number, b: number) => Math.abs(a - b) >= EPSILON;

// 値が変わったときの差分（前に表示していた値との差）。stamp は変わるたびに1つ増える。
// resetKey（ターンの id）が変わって値が同じなら、差分を消す
export function useChange(value: number | null, resetKey: string): { delta: number | null; stamp: number } {
  const [previous, setPrevious] = useState({ value, resetKey });
  const [delta, setDelta] = useState<number | null>(null);
  const [stamp, setStamp] = useState(0);

  if (previous.value !== value || previous.resetKey !== resetKey) {
    setPrevious({ value, resetKey });
    if (value !== null && previous.value !== null && isMoved(value, previous.value)) {
      setDelta(value - previous.value);
      setStamp((n) => n + 1);
    } else if (previous.resetKey !== resetKey) {
      setDelta(null);
    }
  }
  return { delta, stamp };
}

// key が変わってから（出てから）HIGHLIGHT_MS の間だけ true。key が null なら false
export function useHot(key: string | null): boolean {
  const [state, setState] = useState({ key, hot: key !== null });
  if (state.key !== key) setState({ key, hot: key !== null });

  useEffect(() => {
    if (key === null) return;
    const timer = window.setTimeout(
      () => setState((current) => (current.key === key ? { ...current, hot: false } : current)),
      HIGHLIGHT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [key]);

  return state.hot;
}
