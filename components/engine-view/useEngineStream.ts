"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { engineEventsUrl, fetchEngineSnapshot } from "@/lib/api";
import type { EngineEvent } from "@/lib/engine-view/events";
import { engineViewReducer, INITIAL_VIEW_STATE, shouldLoadSnapshot } from "@/lib/engine-view/view-state";

// GET /api/debug/engine-events を EventSource で受け、届いた出来事を1件ずつ順に画面に反映する。
// サーバーの処理は一瞬で終わることがあるので、画面の側で最低 STEP_MS ずつ待つ（API は遅くしない）。
// つながるたび（開いたとき・つなぎ直したとき）に今の値（GET /api/debug/engine-snapshot）を読み、「待機中」として出す。
// ただし turn_start 以降のターンを出しているときは読まない（shouldLoadSnapshot）

export type ConnectionState = "connecting" | "open" | "reconnecting";

const STEP_MS = 700;
// キューがこれより多いときは、待ち時間を縮めて追いつく
const BACKLOG = 10;
const FAST_STEP_MS = 300;
const RECONNECT_MS = 2000;

export function useEngineStream() {
  const [view, dispatch] = useReducer(engineViewReducer, INITIAL_VIEW_STATE);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  // つながったときに今の表示を見るため（EventSource のコールバックから読む）
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const queue: EngineEvent[] = [];
    let timer: number | null = null;
    let source: EventSource | null = null;
    let retry: number | undefined;
    let lastSeq: number | null = null;
    let stopped = false;

    // 1件反映したら、次まで STEP_MS（キューが多ければ FAST_STEP_MS）待つ。キューが空になったら止まる
    const pump = () => {
      if (timer !== null) return;
      const step = () => {
        const next = queue.shift();
        if (!next) {
          timer = null;
          return;
        }
        dispatch({ kind: "event", event: next });
        timer = window.setTimeout(step, queue.length > BACKLOG ? FAST_STEP_MS : STEP_MS);
      };
      step();
    };

    // 今の値を読んで「待機中」にする。読んでいる間に出来事が届いた・処理中（キューが空でない）なら捨てる（古い値で上書きしない）
    let snapshotRequest = 0;
    const loadSnapshot = async () => {
      const request = ++snapshotRequest;
      const seqAtStart = lastSeq;
      try {
        const current = await fetchEngineSnapshot();
        const busy = queue.length > 0 || timer !== null || lastSeq !== seqAtStart;
        if (stopped || request !== snapshotRequest || busy) return;
        dispatch({ kind: "idle", current, loadedAt: Date.now() });
      } catch {
        // 読めなければ、今の表示のまま
      }
    };

    const connect = () => {
      // 最初は新しい出来事だけ。つなぎ直しは、最後に受け取った seq より後から
      source = new EventSource(engineEventsUrl(lastSeq));
      source.onopen = () => {
        setConnection("open");
        if (shouldLoadSnapshot(viewRef.current)) void loadSnapshot();
      };
      source.onmessage = (message) => {
        let event: EngineEvent;
        try {
          event = JSON.parse(message.data) as EngineEvent;
        } catch {
          return;
        }
        if (lastSeq !== null && event.seq <= lastSeq) return;
        lastSeq = event.seq;
        queue.push(event);
        pump();
      };
      source.onerror = () => {
        // EventSource の自動のつなぎ直しは after を付けないので、閉じて自分でつなぎ直す
        source?.close();
        if (stopped) return;
        setConnection("reconnecting");
        retry = window.setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();

    return () => {
      stopped = true;
      source?.close();
      window.clearTimeout(retry);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return { view, connection };
}
