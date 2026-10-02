import { describe, expect, it, vi } from "vitest";
import type { DailyCheckin, Level } from "@/lib/schemas";
import { chatFixture, TODAY } from "@/lib/server/replan-chat/__tests__/helpers";
import { checkinText, saveCheckinWithEngineView, type EngineViewBase } from "../checkin";
import type { EngineEventPayload } from "../events";

// POST /api/checkin の出来事（turn_start → state_update → turn_end）。DB の代わりに load・save を渡す

type Values = { mood: Level | null; fatigue: Level | null; concentration: Level | null };

const row = (values: Partial<Values>): DailyCheckin => ({
  date: TODAY, mood: null, fatigue: null, concentration: null, want_task_ids: [], avoid_task_ids: [], note: null, ...values,
});

function setup(stored: DailyCheckin | null, options: { noPlan?: boolean } = {}) {
  const fixture = chatFixture();
  const base: EngineViewBase = {
    context: { ...fixture.context, checkin: stored },
    days: options.noPlan ? null : fixture.beforeDays,
  };
  const events: EngineEventPayload[] = [];
  const view = { load: vi.fn(async () => base), emit: (e: EngineEventPayload) => events.push(e), elapsedMs: () => 5 };
  return { events, view };
}

describe("saveCheckinWithEngineView", () => {
  it("fatigue null → high：turn_start → state_update → turn_end の順。保存した値を返す", async () => {
    const { events, view } = setup(null);
    const values: Values = { fatigue: "high", concentration: "medium", mood: "low" };
    const saved = row(values);
    const save = vi.fn(async () => saved);

    expect(await saveCheckinWithEngineView(values, save, view)).toBe(saved);
    expect(save).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(["turn_start", "state_update", "turn_end"]);

    const start = events[0] as Extract<EngineEventPayload, { type: "turn_start" }>;
    expect(start.text).toBe("疲労：疲れている・集中：ふつう・気分：落ち込み気味");
    expect(start.snapshot.checkin.fatigue).toBeNull();
    expect(start.before_features).not.toBeNull();
    expect(start.before_distances).not.toBeNull();

    const update = events[1] as Extract<EngineEventPayload, { type: "state_update" }>;
    expect(update.before.checkin.fatigue).toBeNull();
    expect(update.after.checkin.fatigue).toBe("high");
    expect(update.after.directions.balanced.recovery).toBeGreaterThan(update.before.directions.balanced.recovery);
    expect(update.after_distances).not.toBeNull();

    expect(events[2]).toEqual({ type: "turn_end", ms: 5, reply_type: "checkin", proposals: 0, message: "" });
  });

  it("同じ値で送り直すと state_update は出ない", async () => {
    const values: Values = { fatigue: "high", concentration: "medium", mood: "low" };
    const { events, view } = setup(row(values));
    await saveCheckinWithEngineView(values, async () => row(values), view);
    expect(events.map((e) => e.type)).toEqual(["turn_start", "turn_end"]);
  });

  it("有効な計画がないとき：例外にならず、features・距離は null、today_fits は空", async () => {
    const { events, view } = setup(null, { noPlan: true });
    const values: Values = { fatigue: "high", concentration: "low", mood: "medium" };
    await saveCheckinWithEngineView(values, async () => row(values), view);
    const start = events[0] as Extract<EngineEventPayload, { type: "turn_start" }>;
    expect(start.before_features).toBeNull();
    expect(start.before_distances).toBeNull();
    expect(start.snapshot.today_fits).toEqual([]);
    const update = events[1] as Extract<EngineEventPayload, { type: "state_update" }>;
    expect(update.after_distances).toBeNull();
    expect(events.map((e) => e.type)).toEqual(["turn_start", "state_update", "turn_end"]);
  });

  it("view が null なら save だけ。読み込みに失敗しても保存は行い、出来事は出さない", async () => {
    const saved = row({ fatigue: "low" });
    expect(await saveCheckinWithEngineView({ fatigue: "low" }, async () => saved, null)).toBe(saved);

    const events: EngineEventPayload[] = [];
    const save = vi.fn(async () => saved);
    const view = { load: async (): Promise<EngineViewBase> => { throw new Error("db"); }, emit: (e: EngineEventPayload) => events.push(e), elapsedMs: () => 0 };
    expect(await saveCheckinWithEngineView({ fatigue: "low" }, save, view)).toBe(saved);
    expect(save).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it("checkinText は送った項目だけを、疲労・集中・気分の順に並べる", () => {
    expect(checkinText({ mood: "high", fatigue: "low" })).toBe("疲労：元気・気分：良い");
  });
});
