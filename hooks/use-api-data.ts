"use client";

import { useCallback, useEffect, useState, type DependencyList } from "react";

type ApiDataState<T> = { status: "loading" } | { status: "error"; error: unknown } | { status: "success"; data: T };

/**
 * lib/api.ts の関数を呼び、ローディング・エラー・成功の状態を返す（mock-spec.md 1.4 の状態表示用）。
 * retry を呼ぶとローディングに戻して取り直す（ErrorState の「再試行」に渡す）。
 */
export function useApiData<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<ApiDataState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setState({ status: "success", data });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: "error", error });
      },
    );
    return () => {
      cancelled = true;
    };
    // load は呼び出し側で毎回作り直されるため、deps で取り直しの条件を指定してもらう
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ...deps]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
