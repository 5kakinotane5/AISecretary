// ---------- 4.1章 モックの状態 ----------
// サーバーのメモリ上に1人分の状態を持つ（再起動で初期値に戻る）。
// まだモックの /api/plans/replan が使うデモ時刻だけが残っている（lib/mock/clock.ts）
type MockState = {
  demo_now: string;
};

function initialState(): MockState {
  return {
    demo_now: "2026-10-05T07:00:00+09:00",
  };
}

let state: MockState = initialState();

export function getState(): MockState {
  return state;
}

export function resetState(): void {
  state = initialState();
}

export function setDemoNow(now: string): void {
  state = { ...state, demo_now: now };
}
