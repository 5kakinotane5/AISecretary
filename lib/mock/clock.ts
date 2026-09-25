import { toDateStr } from "@/lib/datetime";
import { getState, setDemoNow } from "./store";

// ---------- 10.6章 /replan のデモ時刻 ----------
// demo_now が18:00より前なら18:00に進める。すでに18:00以降なら何もしない。
export function advanceToEighteenIfBefore(): { now: string; advanced: boolean } {
  const current = getState().demo_now;
  const eighteen = `${toDateStr(current)}T18:00:00+09:00`;
  if (current < eighteen) {
    setDemoNow(eighteen);
    return { now: eighteen, advanced: true };
  }
  return { now: current, advanced: false };
}

/** POST /api/mock/clock：now が指定されればその時刻に設定し、無ければ10.6章の自動繰り上げを行う */
export function applyClockRequest(now: string | null | undefined): { now: string } {
  if (now) {
    setDemoNow(now);
    return { now };
  }
  return { now: advanceToEighteenIfBefore().now };
}
