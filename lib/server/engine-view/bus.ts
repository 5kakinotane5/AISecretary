import { EventEmitter } from "node:events";
import type { EngineEvent, EngineEventInput } from "./events";

// 発表用の別画面（/engine-view）に出来事を流す、プロセス内の1本の流れ。
// dev の HMR でモジュールが読み直されても二重にならないように、globalThis のキーで1つだけ持つ

const BUFFER_SIZE = 300;
const EVENT_NAME = "event";

type Bus = { emitter: EventEmitter; buffer: EngineEvent[]; seq: number };

const KEY = Symbol.for("ai-secretary.engine-view.bus");
type GlobalWithBus = typeof globalThis & { [KEY]?: Bus };

function getBus(): Bus {
  const store = globalThis as GlobalWithBus;
  if (!store[KEY]) {
    const emitter = new EventEmitter();
    // 別画面を複数開いても警告を出さない
    emitter.setMaxListeners(0);
    store[KEY] = { emitter, buffer: [], seq: 0 };
  }
  return store[KEY];
}

export function isEngineViewEnabled(): boolean {
  return process.env.ENGINE_VIEW === "on";
}

// seq を振ってバッファに入れ、流す。中で例外が出ても外に投げない（本番の処理を止めない）
export function publish(input: EngineEventInput): void {
  try {
    const bus = getBus();
    bus.seq += 1;
    const event = { ...input, seq: bus.seq } as EngineEvent;
    bus.buffer.push(event);
    if (bus.buffer.length > BUFFER_SIZE) bus.buffer.splice(0, bus.buffer.length - BUFFER_SIZE);
    // 受け手は subscribe で例外を握りつぶす形に包んである
    bus.emitter.emit(EVENT_NAME, event);
  } catch {
    // 何もしない
  }
}

// userId の出来事を受け取る。afterSeq より後のバッファ分を先に渡してから、新しい出来事を渡す。解除の関数を返す
export function subscribe(userId: string, afterSeq: number, listener: (event: EngineEvent) => void): () => void {
  const bus = getBus();
  const safe = (event: EngineEvent) => {
    if (event.user_id !== userId) return;
    try {
      listener(event);
    } catch {
      // 受け手の例外は外に出さない
    }
  };
  for (const event of bus.buffer) if (event.seq > afterSeq) safe(event);
  bus.emitter.on(EVENT_NAME, safe);
  return () => {
    bus.emitter.off(EVENT_NAME, safe);
  };
}

// テスト用：バッファと連番を空にする
export function resetEngineViewBusForTest(): void {
  const bus = getBus();
  bus.emitter.removeAllListeners(EVENT_NAME);
  bus.buffer = [];
  bus.seq = 0;
}
