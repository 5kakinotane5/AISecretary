import { describe, expect, it } from "vitest";
import type { DailyCheckin, Level, PlanningContext } from "@/lib/schemas";
import { chatFixture, TODAY } from "@/lib/server/replan-chat/__tests__/helpers";
import { buildParamSnapshot, computeFeatures, directionDistances } from "../snapshot";

// 発表用の別画面のパラメータ（P2.1・P4・P6・P8・P9.1）。fixtures：10/5 18:00、TOEIC バランス

const KEYS = ["achievement", "deadline_safety", "task_fit", "buffer", "free_time", "control", "recovery"] as const;
const STYLES = ["intensive", "balanced", "relaxed"] as const;
const clip = (value: number) => Math.min(1, Math.max(0, value));

const checkin = (fatigue: Level | null, concentration: Level | null = null): DailyCheckin => ({
  date: TODAY, mood: null, fatigue, concentration, want_task_ids: [], avoid_task_ids: [], note: null,
});
const withCheckin = (context: PlanningContext, value: DailyCheckin | null): PlanningContext => ({ ...context, checkin: value });

describe("buildParamSnapshot", () => {
  it("fatigue null → high：D_k・今日の w_k が P9.1 の量だけ変わり、TOEIC リスニング演習の Fit が 0 になる", () => {
    const { context, beforeDays } = chatFixture();
    const before = buildParamSnapshot(withCheckin(context, null), beforeDays);
    const after = buildParamSnapshot(withCheckin(context, checkin("high")), beforeDays);

    expect(before.checkin.fatigue).toBeNull();
    expect(after.checkin.fatigue).toBe("high");
    for (const style of STYLES) {
      const b = before.directions[style];
      const a = after.directions[style];
      expect(a.recovery).toBeCloseTo(clip(b.recovery + 0.15), 10);
      expect(a.free_time).toBeCloseTo(clip(b.free_time + 0.1), 10);
      expect(a.achievement).toBeCloseTo(clip(b.achievement - 0.1), 10);
      for (const key of ["deadline_safety", "task_fit", "buffer", "control"] as const) expect(a[key]).toBe(b[key]);

      const bw = before.beam_weights[style];
      const aw = after.beam_weights[style];
      expect(aw).toHaveLength(6);
      expect(aw[4]).toBeCloseTo(clip(bw[4] + 0.1), 10);
      expect(aw[5]).toBeCloseTo(clip(bw[5] + 0.2), 10);
      expect(aw.slice(0, 4)).toEqual(bw.slice(0, 4));
    }

    const listening = after.today_fits.find((row) => row.title.includes("TOEIC") && row.title.includes("リスニング"));
    expect(listening).toBeDefined();
    expect(listening!.high_concentration).toBe(true);
    expect(listening!.fatigue_fit).toBe(0);
    expect(listening!.gate).toBe(0);
    expect(listening!.fit).toBe(0);
    // 変える前は置ける
    const beforeListening = before.today_fits.find((row) => row.item_id === listening!.item_id)!;
    expect(beforeListening.fatigue_fit).toBe(1);
    expect(beforeListening.gate).toBe(1);
  });

  it("today_fits は今日の now より後に終わる未完了のタスクだけ（時刻順）", () => {
    const { context, beforeDays } = chatFixture();
    const rows = buildParamSnapshot(context, beforeDays).today_fits;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.start_at.slice(0, 10)).toBe(TODAY);
      expect(row.end_at > context.now).toBe(true);
    }
    expect(rows.map((row) => row.start_at)).toEqual([...rows.map((row) => row.start_at)].sort());
  });

  it("fatigue null → medium：D_k・w_k は変わらない（P9.1 は high だけ）。高集中タスクの fatigue_fit は 0.6", () => {
    const { context, beforeDays } = chatFixture();
    const before = buildParamSnapshot(withCheckin(context, null), beforeDays);
    const after = buildParamSnapshot(withCheckin(context, checkin("medium")), beforeDays);
    expect(after.directions).toEqual(before.directions);
    expect(after.beam_weights).toEqual(before.beam_weights);
    const high = after.today_fits.filter((row) => row.high_concentration);
    expect(high.length).toBeGreaterThan(0);
    for (const row of high) expect(row.fatigue_fit).toBe(0.6);
  });

  it("有効な計画がない（days が null）→ today_fits は空", () => {
    const { context } = chatFixture();
    expect(buildParamSnapshot(context, null).today_fits).toEqual([]);
  });
});

describe("computeFeatures・directionDistances", () => {
  it("Before の F(S) の7成分はすべて 0〜1。task_fit は 1 固定ではない（疲れると下がる）", () => {
    const { context, beforeDays } = chatFixture();
    const features = computeFeatures(withCheckin(context, null), beforeDays);
    expect(features).not.toBeNull();
    for (const key of KEYS) {
      expect(features![key]).toBeGreaterThanOrEqual(0);
      expect(features![key]).toBeLessThanOrEqual(1);
    }
    const tired = computeFeatures(withCheckin(context, checkin("high")), beforeDays);
    expect(tired!.task_fit).toBeLessThan(1);
    expect(tired!.task_fit).toBeLessThan(features!.task_fit);

    const distances = directionDistances(features, buildParamSnapshot(context, beforeDays).directions);
    expect(distances).not.toBeNull();
    for (const style of STYLES) expect(distances![style]).toBeGreaterThan(0);
  });

  it("days が null → features も距離も null", () => {
    const { context } = chatFixture();
    expect(computeFeatures(context, null)).toBeNull();
    expect(directionDistances(null, buildParamSnapshot(context, null).directions)).toBeNull();
  });
});
