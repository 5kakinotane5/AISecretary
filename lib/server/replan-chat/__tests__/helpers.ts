import { generatePlans } from "@/lib/planning/generate";
import { createPlanningContext } from "@/lib/planning/__tests__/fixtures";
import { validatePlan } from "@/lib/planning/validate";
import type { DayPlan, FixedEvent, PlannedItem, PlanningContext, ReplanOpLlm } from "@/lib/schemas";
import { withTodayLockedItems } from "@/lib/server/replan-base";
import type { ApplyOpsResult } from "../apply-ops";

// 会話の再計画のテスト用の準備（replan-chat.md 12.15）。
// バランスプランを生成し、lib/planning/__tests__/replan.test.ts の fixtureBefore()・applyDisplayState() と同じやり方で
// now の Before（表示用の計算・reason_code 付き）と、12.2 の 6 と同じ context（locked_items 込み）を作る

export const NOW = "2026-10-05T18:00:00+09:00";
export const TODAY = "2026-10-05";

export type ChatFixture = {
  context: PlanningContext;
  beforeDays: { date: string; items: PlannedItem[] }[];
};

// 表示用の計算（11.3）：終わった項目は locked（タスクは completed）。進行中はタスク・固定予定・移動・睡眠だけ locked
function applyDisplayState(days: readonly DayPlan[], now: string): DayPlan[] {
  return days.map((day) => ({ date: day.date, items: day.items.map((item) => {
    if (item.end_at <= now) return { ...item, locked: true, status: item.kind === "task" ? "completed" as const : item.status };
    if (item.start_at < now && now < item.end_at) {
      return { ...item, locked: ["task", "fixed", "travel", "sleep"].includes(item.kind) };
    }
    return { ...item };
  }) }));
}

let generated: { context: PlanningContext; days: { date: string; items: PlannedItem[] }[] } | null = null;

// 生成は重いので1回だけ行い、呼ぶたびに独立したコピーを返す
export function chatFixture(now = NOW): ChatFixture {
  if (!generated) {
    const context = createPlanningContext();
    const result = generatePlans(context);
    if (!result.ok) throw new Error(result.infeasible.reason);
    generated = { context, days: result.plans[1].days };
  }
  const base = structuredClone(generated);
  base.context.now = now;
  base.context.style = "balanced";
  // API と同じく reason_code のない DayPlan に表示用の計算をかけ、保存されている reason_code を付け直す（12.2 の engineBeforeDays）
  const reasonCodes = new Map(base.days.flatMap((day) => day.items.map((item) => [item.id, item.reason_code] as const)));
  const apiDays: DayPlan[] = base.days.map((day) => ({
    date: day.date,
    items: day.items.map((item) => {
      const scheduleItem = { ...item } as Partial<PlannedItem>;
      delete scheduleItem.reason_code;
      return scheduleItem as DayPlan["items"][number];
    }),
  }));
  const beforeDays = applyDisplayState(apiDays, now).map((day) => ({
    date: day.date,
    items: day.items.map((item) => ({ ...item, reason_code: reasonCodes.get(item.id) ?? null })),
  }));
  const beforeToday = beforeDays.find((day) => day.date === now.slice(0, 10))?.items ?? [];
  return { context: withTodayLockedItems(base.context, beforeToday, now), beforeDays };
}

// 連番の id
export function idFactory(prefix = "new"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

// 使わない項目を null・空配列で埋めた操作
export function op(value: Partial<ReplanOpLlm> & Pick<ReplanOpLlm, "op">): ReplanOpLlm {
  return {
    item_id: null,
    item_ids: [],
    title: null,
    start: null,
    end: null,
    minutes: null,
    date: null,
    position: null,
    repeat: null,
    weekday: null,
    category: null,
    deadline_date: null,
    deadline_time: null,
    importance: null,
    concentration: null,
    ...value,
  };
}

export const at = (date: string, time: string) => `${date}T${time}:00+09:00`;

// 12.11 の 2 と同じ検査（足した予定・タスクを context に入れ、after の7日分を Before と比べる。replan-add.md 12.19）
export function validateApplied(fixture: ChatFixture, applied: ApplyOpsResult, fixedEvents?: FixedEvent[]) {
  const context = {
    ...fixture.context,
    tasks: [...fixture.context.tasks, ...applied.newTasks],
    fixed_events: fixedEvents ?? [...fixture.context.fixed_events, ...applied.newFixedEvents],
  };
  const updated = new Map(applied.result.updated_days.map((day) => [day.date, day]));
  const afterDays = fixture.beforeDays.map((day) => updated.get(day.date) ?? day);
  return {
    afterDays,
    validation: validatePlan(context, afterDays, "replan", {
      before: fixture.beforeDays,
      allowedInProgressTaskSplitIds: applied.splitTaskIds,
    }),
  };
}

export const todayItems = (applied: ApplyOpsResult) =>
  applied.result.updated_days.find((day) => day.date === TODAY)!.items;

export const findBefore = (fixture: ChatFixture, date: string, predicate: (item: PlannedItem) => boolean) =>
  fixture.beforeDays.find((day) => day.date === date)!.items.find(predicate)!;

// 空きが足りない日を作る：その日の自由時間（locked でない）を、同じ時刻・場所の固定予定にする（Before と context の両方に足す）
export function blockFreeTime(fixture: ChatFixture, date: string): void {
  const day = fixture.beforeDays.find((entry) => entry.date === date)!;
  day.items = day.items.map((item) => {
    if (item.kind !== "free" || item.locked) return item;
    const event: FixedEvent = {
      id: `block-${item.id}`,
      title: "予定",
      category: "other",
      location_id: item.location_id,
      start_at: item.start_at,
      end_at: item.end_at,
      recurrence: null,
    };
    fixture.context.fixed_events.push(event);
    return { ...item, kind: "fixed", title: "予定", fixed_event_id: event.id, fixed_category: "other", locked: true, reason: null, reason_code: null };
  });
}
