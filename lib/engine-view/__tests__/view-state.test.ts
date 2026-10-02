import { describe, expect, it } from "vitest";
import type { DailyCheckin } from "@/lib/schemas";
import { buildCurrentView, saveCheckinWithEngineView } from "@/lib/server/engine-view/checkin";
import { chatFixture, TODAY } from "@/lib/server/replan-chat/__tests__/helpers";
import type { EngineEvent, EngineEventPayload, EngineEventSource } from "../events";
import {
  applyEngineEvent,
  engineViewReducer,
  INITIAL_VIEW_STATE,
  nearestStyle,
  shouldLoadSnapshot,
  type ViewState,
} from "../view-state";

// 別画面の表示の状態（docs/design/engine-view.md 13-2）。サーバーの関数で作った本物の出来事を流して確かめる

let seq = 0;
const stamp = (payload: EngineEventPayload, turnId: string, source: EngineEventSource, tMs = 0): EngineEvent =>
  ({ ...payload, seq: ++seq, turn_id: turnId, user_id: "user-1", source, t_ms: tMs }) as EngineEvent;

async function checkinEvents(turnId: string): Promise<EngineEvent[]> {
  const fixture = chatFixture();
  const payloads: EngineEventPayload[] = [];
  const saved: DailyCheckin = {
    date: TODAY, mood: "low", fatigue: "high", concentration: "medium", want_task_ids: [], avoid_task_ids: [], note: null,
  };
  await saveCheckinWithEngineView(
    { fatigue: "high", concentration: "medium", mood: "low" },
    async () => saved,
    { load: async () => ({ context: { ...fixture.context, checkin: null }, days: fixture.beforeDays }), emit: (e) => payloads.push(e), elapsedMs: () => 100 },
  );
  return payloads.map((payload, i) => stamp(payload, turnId, "checkin", i * 50));
}

const run = (events: EngineEvent[], state: ViewState = INITIAL_VIEW_STATE) => events.reduce(applyEngineEvent, state);

describe("applyEngineEvent", () => {
  it("チェックイン：受付 → 状態を更新 → 完了。① の起点は turn_start、今の値は state_update の after", async () => {
    const events = await checkinEvents("turn-a");
    const afterStart = run(events.slice(0, 1));
    expect(afterStart.turn).toMatchObject({ source: "checkin", stage: 0, done: false });
    expect(afterStart.turn!.snapshot.checkin.fatigue).toBeNull();

    const afterUpdate = run(events.slice(1, 2), afterStart);
    expect(afterUpdate.turn!.stage).toBe(2);
    expect(afterUpdate.turn!.startSnapshot.checkin.fatigue).toBeNull();
    expect(afterUpdate.turn!.snapshot.checkin.fatigue).toBe("high");
    expect(afterUpdate.turn!.afterDistances).not.toBeNull();
    expect(afterUpdate.turn!.afterFeatures!.task_fit).toBeLessThan(afterUpdate.turn!.beforeFeatures!.task_fit);

    const end = run(events.slice(2), afterUpdate);
    expect(end.turn).toMatchObject({ stage: 3, done: true, replyType: "checkin", proposals: null });
    expect(end.log.map((line) => line.text)).toEqual([
      "受付（今日の調子）：疲労：疲れている・集中：ふつう・気分：落ち込み気味",
      "状態を更新：疲れ 不明 → high・集中 不明 → medium → D_k・w_k・Fit を再計算",
      "完了",
    ]);
  });

  it("次の turn_start で新しいターンに切り替え、前のターンを previous に残す。ほかのターンの出来事はログにだけ出す", async () => {
    const first = run(await checkinEvents("turn-a"));
    const second = run((await checkinEvents("turn-b")).slice(0, 1), first);
    expect(second.turn!.turnId).toBe("turn-b");
    expect(second.previous!.turnId).toBe("turn-a");

    const stray = applyEngineEvent(second, stamp({ type: "retry", call: 1, reasons: ["x"] }, "turn-a", "replan"));
    expect(stray.turn).toBe(second.turn);
    expect(stray.log).toHaveLength(second.log.length + 1);
  });

  it("会話：案の検査は同じ番号を新しい方で置き換え、やり直しを数える", async () => {
    const [start] = await checkinEvents("turn-r");
    const replanStart = { ...start, source: "replan" as const, text: "今日は疲れた" } as EngineEvent;
    const option = (call: number, ok: boolean) =>
      stamp(
        { type: "option_check", call, index: 1, label: "今夜は軽めにする", ok, errors: ok ? [] : ["だめ"], warnings: [], changes: ok ? 3 : 0, after_features: null, distances: null },
        "turn-r",
        "replan",
      );
    const state = run([
      replanStart,
      stamp({ type: "llm_start", call: 1, feedback_count: 0 }, "turn-r", "replan"),
      option(1, false),
      stamp({ type: "retry", call: 1, reasons: ["だめ"] }, "turn-r", "replan"),
      option(2, true),
      stamp({ type: "turn_end", ms: 900, reply_type: "proposal", proposals: 1, message: "" }, "turn-r", "replan"),
    ]);
    expect(state.turn!.options).toHaveLength(1);
    expect(state.turn!.options[0]).toMatchObject({ call: 2, ok: true, changes: 3 });
    expect(state.turn).toMatchObject({ retries: 1, stage: 4, done: true, proposals: 1 });
    expect(state.log.at(-1)!.text).toBe("返事（proposal・案 1つ）");
  });

  it("nearestStyle は距離が一番小さい方向", () => {
    expect(nearestStyle({ intensive: 0.5, balanced: 0.3, relaxed: 0.21 })).toBe("relaxed");
    expect(nearestStyle(null)).toBeNull();
  });
});

describe("待機中のターン（GET /api/debug/engine-snapshot）", () => {
  it("待機中 → turn_start → state_update：① は「不明 → high」、② は待機中の値から P9.1 の量だけ動く", async () => {
    const fixture = chatFixture();
    const current = buildCurrentView({ context: { ...fixture.context, checkin: null }, days: fixture.beforeDays });
    const idle = engineViewReducer(INITIAL_VIEW_STATE, { kind: "idle", current, loadedAt: 1 });
    expect(idle.turn).toMatchObject({ turnId: "idle-1", source: "idle", stage: -1, done: false });
    // 待機中は ① の起点も今の値（差分は出ない）
    expect(idle.turn!.startSnapshot).toBe(idle.turn!.snapshot);
    expect(idle.turn!.snapshot.checkin.fatigue).toBeNull();
    expect(idle.turn!.beforeFeatures).toEqual(current.features);
    expect(idle.log).toEqual([]);

    const events = await checkinEvents("turn-c");
    const started = run(events.slice(0, 1), idle);
    // 待機中のターンは previous に移る。待機中の値と turn_start の値は同じ（差分は state_update で初めて出る）
    expect(started.previous!.source).toBe("idle");
    expect(started.turn!.snapshot).toEqual(idle.turn!.snapshot);

    const updated = run(events.slice(1, 2), started);
    expect(updated.turn!.startSnapshot.checkin.fatigue).toBeNull();
    expect(updated.turn!.snapshot.checkin.fatigue).toBe("high");
    const clip = (value: number) => Math.min(1, Math.max(0, value));
    for (const style of ["intensive", "balanced", "relaxed"] as const) {
      const from = idle.turn!.snapshot.directions[style];
      const to = updated.turn!.snapshot.directions[style];
      expect(to.recovery).toBeCloseTo(clip(from.recovery + 0.15), 10);
      expect(to.free_time).toBeCloseTo(clip(from.free_time + 0.1), 10);
      expect(to.achievement).toBeCloseTo(clip(from.achievement - 0.1), 10);
      const fromW = idle.turn!.snapshot.beam_weights[style];
      const toW = updated.turn!.snapshot.beam_weights[style];
      expect(toW[4]).toBeCloseTo(clip(fromW[4] + 0.1), 10);
      expect(toW[5]).toBeCloseTo(clip(fromW[5] + 0.2), 10);
    }
  });

  it("つなぎ直し：turn_start 以降のターンを出しているときは今の値を読まず、届いても捨てる。待機中なら新しい値に置き換える", async () => {
    const fixture = chatFixture();
    const current = buildCurrentView({ context: fixture.context, days: fixture.beforeDays });
    expect(shouldLoadSnapshot(INITIAL_VIEW_STATE)).toBe(true);

    // 待機中 → 読み直した値で置き換える
    const idle = engineViewReducer(INITIAL_VIEW_STATE, { kind: "idle", current, loadedAt: 1 });
    expect(shouldLoadSnapshot(idle)).toBe(true);
    const reloaded = engineViewReducer(idle, { kind: "idle", current, loadedAt: 2 });
    expect(reloaded.turn!.turnId).toBe("idle-2");

    // turn_start 以降（処理の途中・終わったあと）→ 読まない。届いても表示は変えない
    const events = await checkinEvents("turn-d");
    for (const shown of [run(events.slice(0, 1), reloaded), run(events, reloaded)]) {
      expect(shouldLoadSnapshot(shown)).toBe(false);
      expect(engineViewReducer(shown, { kind: "idle", current, loadedAt: 3 })).toBe(shown);
    }
  });
});
