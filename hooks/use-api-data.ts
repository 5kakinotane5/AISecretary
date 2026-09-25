"use client";

import { useCallback, useEffect, useState, type DependencyList } from "react";

/**
 * 画面が区別して表示する4つの状態（mock-spec.md 1.4）。
 * - loading：取得中（今の deps・再試行の回数に対する結果がまだない）
 * - error：取得に失敗した（「再試行」で取り直せる）
 * - empty：取得できたが、表示するデータがない（isEmpty が true を返した）
 * - success：表示するデータがある
 */
export type ApiDataState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "empty"; data: T }
  | { status: "success"; data: T };

type Outcome<T> = { ok: true; data: T } | { ok: false; error: unknown };

/** どの取得に対する結果かを覚えておく（古い結果を今の結果として見せないため） */
type Settled<T> = { deps: DependencyList; attempt: number; outcome: Outcome<T> };

type UseApiDataOptions<T> = {
  /** 取得したデータが「データなし」かどうか（例：空の配列）。省略すると empty にはならない */
  isEmpty?: (data: T) => boolean;
};

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

/**
 * lib/api.ts の関数を呼び、読み込み中・エラー・データなし・成功の状態を返す（mock-spec.md 1.4 の状態表示用）。
 * retry を呼ぶと読み込み中に戻して取り直す（ErrorState の「再試行」に渡す）。
 * deps が変わったときも、前の結果を出したままにせず読み込み中に戻す。
 */
export function useApiData<T>(
  load: () => Promise<T>,
  deps: DependencyList,
  options: UseApiDataOptions<T> = {},
): ApiDataState<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setSettled({ deps, attempt, outcome: { ok: true, data } });
      },
      (error: unknown) => {
        if (!cancelled) setSettled({ deps, attempt, outcome: { ok: false, error } });
      },
    );
    return () => {
      cancelled = true;
    };
    // load は呼び出し側で毎回作り直されるため、deps で取り直しの条件を指定してもらう
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ...deps]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // 今の deps・再試行の回数に対する結果だけを使う。まだなければ読み込み中
  const current = settled && settled.attempt === attempt && sameDeps(settled.deps, deps) ? settled.outcome : null;

  if (current === null) return { status: "loading", retry };
  if (!current.ok) return { status: "error", error: current.error, retry };
  if (options.isEmpty?.(current.data)) return { status: "empty", data: current.data, retry };
  return { status: "success", data: current.data, retry };
}
