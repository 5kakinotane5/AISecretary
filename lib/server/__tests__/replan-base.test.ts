import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePlans } from "@/lib/planning/generate";
import { createPlanningContext } from "@/lib/planning/__tests__/fixtures";
import { replan } from "@/lib/planning/replan";
import type { DayPlan, EnginePlan, PlanningContext, ReplanProposal } from "@/lib/schemas";
import { withDisplayState } from "@/lib/server/calendar";
import { withPastGoalMinutes, withStoredReasonCodes, withTodayLockedItems, type ReplanBase } from "@/lib/server/replan-base";
import { replanByIntent } from "@/lib/server/replan-by-intent";
import type { PlanItemRow } from "@/lib/server/repositories/plans";

// 再計画の準備（lib/server/replan-base.ts）と、意図＋Engine（lib/server/replan-by-intent.ts）。
// 不具合：過ぎたのに未チェック（補正 C-23）の目標タスクの枠があると、replan() の検証が
// 「{目標}の週合計が{実際}分で、想定の{W − D}分と異なります」で失敗していた

const GOAL = "goal_toeic";
const STATE_CHANGE = { type: "state_change" as const, fatigue: "high" as const, task_changes: [], new_fixed_events: [], preference_changes: [] };

let generated: { context: PlanningContext; plan: EnginePlan };

beforeAll(() => {
  const context = createPlanningContext();
  const result = generatePlans(context);
  if (!result.ok) throw new Error(result.infeasible.reason);
  generated = { context, plan: result.plans[1] };
}, 60_000);

// loadReplanBase() と同じ準備を、DB の代わりに生成した計画で行う。
// 保存されている状態は「チェックした枠だけ completed」（補正 C-23）。checked は completed にする項目の task_id と日付
function prepare(now: string, checked: { date: string; taskId: string }[] = [], goalDone = 0) {
  const storedRows = new Map<string, PlanItemRow>();
  const stored: DayPlan[] = generated.plan.days.map((day) => ({
    date: day.date,
    items: day.items.map((planned) => {
      const item = { ...planned } as Partial<typeof planned>;
      delete item.reason_code;
      const isChecked = checked.some((c) => c.date === day.date && c.taskId === planned.task_id);
      const scheduleItem = { ...(item as DayPlan["items"][number]), status: isChecked ? "completed" as const : "planned" as const };
      storedRows.set(planned.id, {
        ...scheduleItem, user_id: "user-1", weekly_plan_id: "plan-1", date: day.date, reason_code: planned.reason_code, carried: false,
      });
      return scheduleItem;
    }),
  }));
  const today = now.slice(0, 10);
  const beforeDays = stored.map((day) => ({ date: day.date, items: day.items.map((item) => withDisplayState(item, now)) }));
  const beforeToday = beforeDays.find((day) => day.date === today)!.items;
  const built: PlanningContext = {
    ...structuredClone(generated.context),
    now,
    style: "balanced",
    goal_done_minutes: { [GOAL]: goalDone },
  };
  const engineBeforeDays = withStoredReasonCodes(beforeDays, storedRows);
  return { today, beforeDays, beforeToday, engineBeforeDays, storedRows, built };
}

describe("withPastGoalMinutes（再計画の目標の実施済み）", () => {
  // 火曜 18:00：月曜 20:00〜21:00 の TOEIC リスニング演習（60分）は過ぎたが、チェックしていない
  const TUESDAY_18 = "2026-10-06T18:00:00+09:00";

  it("再現：足さないと replan() が週合計の検証で失敗する。足すと通る", () => {
    const { beforeDays, beforeToday, engineBeforeDays, built } = prepare(TUESDAY_18);
    const withoutFix = withTodayLockedItems(built, beforeToday, TUESDAY_18);
    const failed = replan(withoutFix, engineBeforeDays, STATE_CHANGE);
    expect(failed).toEqual({
      ok: false,
      infeasible: expect.objectContaining({ reason: "再計画後の検証に失敗しました：TOEIC学習の週合計が300分で、想定の360分と異なります" }),
    });

    const context = withPastGoalMinutes(withoutFix, beforeDays, TUESDAY_18);
    expect(context.goal_done_minutes).toEqual({ [GOAL]: 60 });
    expect(replan(context, engineBeforeDays, STATE_CHANGE).ok).toBe(true);
  }, 30_000);

  it("チェック済みの枠（すでに D に入っている）は二重に足さない", () => {
    const { beforeDays, beforeToday, engineBeforeDays, built } = prepare(
      TUESDAY_18,
      [{ date: "2026-10-05", taskId: "task_toeic_listening" }],
      60,
    );
    const context = withPastGoalMinutes(withTodayLockedItems(built, beforeToday, TUESDAY_18), beforeDays, TUESDAY_18);
    expect(context.goal_done_minutes).toEqual({ [GOAL]: 60 });
    expect(replan(context, engineBeforeDays, STATE_CHANGE).ok).toBe(true);
  }, 30_000);

  it("過ぎた目標タスクの枠がない（月曜 18:00）ときは context も結果も変わらない", () => {
    const now = "2026-10-05T18:00:00+09:00";
    const { beforeDays, beforeToday, engineBeforeDays, built } = prepare(now);
    const before = withTodayLockedItems(built, beforeToday, now);
    const after = withPastGoalMinutes(before, beforeDays, now);
    expect(after).toEqual(before);
    expect(replan(after, engineBeforeDays, STATE_CHANGE)).toEqual(replan(before, engineBeforeDays, STATE_CHANGE));
  }, 30_000);
});

// ---------- replanByIntent：切り出す前（route.ts の中に書いていた手順）と同じ結果 ----------

// replanByIntent が使う DB の呼び出しだけを持つ偽物
function fakeSupabase() {
  const inserted: { proposal: ReplanProposal }[] = [];
  const checkins: Record<string, unknown>[] = [];
  const from = (table: string) => {
    let row: Record<string, unknown> = {};
    const builder = {
      upsert: (value: Record<string, unknown>) => {
        row = value;
        checkins.push(value);
        return builder;
      },
      select: () => builder,
      eq: () => builder,
      single: async () => ({
        data: { date: row.date, mood: null, fatigue: row.fatigue ?? null, concentration: null, want_task_ids: [], avoid_task_ids: [], note: null },
        error: null,
      }),
      maybeSingle: async () => ({ data: table === "weekly_plans" ? { version: 1 } : null, error: null }),
      insert: async (value: { proposal: ReplanProposal }) => {
        inserted.push(value);
        return { error: null };
      },
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, inserted, checkins };
}

// id は毎回変わるので、比べるときは id を除く
const withoutIds = (proposal: Omit<ReplanProposal, "proposal_id">) =>
  JSON.parse(JSON.stringify(proposal, (key, value) => (key === "id" || key === "proposal_id" ? undefined : value)));

describe("replanByIntent", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_MODE", "off");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["今日は疲れた", "2026-10-05T18:00:00+09:00"],
    ["20時から1時間予定が入った", "2026-10-05T18:00:00+09:00"],
    ["今日は疲れた", "2026-10-06T18:00:00+09:00"],
  ])("「%s」（%s）：切り出す前の手順と同じ提案を保存して返し、base.context を変えない", async (text, now) => {
    const { today, beforeDays, beforeToday, engineBeforeDays, storedRows, built } = prepare(now);
    const context = withPastGoalMinutes(withTodayLockedItems(built, beforeToday, now), beforeDays, now);
    const base: Extract<ReplanBase, { ok: true }> = {
      ok: true,
      now,
      today,
      active: { id: "plan-1", style: "balanced", week_start: "2026-10-05", status: "active" },
      beforeDays,
      beforeToday,
      engineBeforeDays,
      storedRows,
      context,
    };
    const snapshot = structuredClone(context);
    const supabase = fakeSupabase();

    const response = await replanByIntent(supabase.client, "user-1", base, text);
    if ("supported" in response) throw new Error(response.message);

    // 切り出す前の手順：チェックインの更新後の context に、足す予定を入れて replan()
    const expectedContext: PlanningContext = {
      ...structuredClone(snapshot),
      checkin: text.includes("疲れ")
        ? { date: today, mood: null, fatigue: "high", concentration: null, want_task_ids: [], avoid_task_ids: [], note: null }
        : snapshot.checkin,
      fixed_events: [...snapshot.fixed_events, ...response.intent.new_fixed_events],
    };
    const expected = replan(expectedContext, engineBeforeDays, response.intent);
    if (!expected.ok) throw new Error(expected.infeasible.reason);

    expect(withoutIds(response)).toEqual(withoutIds(expected.proposal));
    expect(supabase.inserted).toHaveLength(1);
    expect(supabase.inserted[0].proposal).toEqual(response);
    expect(base.context).toEqual(snapshot);
  }, 30_000);

  it("Engine・Validator が失敗 → 決まった文を返し、理由はログにだけ出す。保存しない", async () => {
    // 火曜 18:00、過ぎた未チェックの目標の枠を D に足さない（直す前の）context：replan() の検証が失敗する
    const now = "2026-10-06T18:00:00+09:00";
    const { today, beforeDays, beforeToday, engineBeforeDays, storedRows, built } = prepare(now);
    const base: Extract<ReplanBase, { ok: true }> = {
      ok: true,
      now,
      today,
      active: { id: "plan-1", style: "balanced", week_start: "2026-10-05", status: "active" },
      beforeDays,
      beforeToday,
      engineBeforeDays,
      storedRows,
      context: withTodayLockedItems(built, beforeToday, now),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = fakeSupabase();

    const response = await replanByIntent(supabase.client, "user-1", base, "今日は疲れた");
    expect(response).toEqual({ supported: false, message: "うまく組み直せませんでした。時間や内容を変えて教えてください。" });
    expect(supabase.inserted).toEqual([]);
    const logged = warn.mock.calls.map((args) => args.join(" "));
    expect(logged).toContain(
      "[replan] engine failed: 再計画後の検証に失敗しました：TOEIC学習の週合計が300分で、想定の360分と異なります / 予定を調整する",
    );
    expect(logged.some((line) => line.includes("今日は疲れた"))).toBe(false);
    warn.mockRestore();
  }, 30_000);
});
