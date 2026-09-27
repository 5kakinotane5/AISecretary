import { describe, expect, it } from "vitest";
import { diffMinutesExact } from "@/lib/datetime";
import { EngineReplanResultSchema, type DayPlan, type ReplanProposal } from "@/lib/schemas";
import { generatePlans } from "../generate";
import { replan } from "../replan";
import { validatePlan } from "../validate";
import { createPlanningContext } from "./fixtures";

const fatigueIntent = (fatigue: "high" | "medium"): ReplanProposal["intent"] => ({ type: "state_change", fatigue, task_changes: [], new_fixed_events: [], preference_changes: [] });

function applyDisplayState(days: readonly DayPlan[], now: string): DayPlan[] {
  return days.map((day) => ({ date: day.date, items: day.items.map((item) => {
    if (item.end_at <= now) return { ...item, locked: true, status: item.kind === "task" ? "completed" as const : item.status };
    if (item.start_at < now && now < item.end_at) {
      return { ...item, locked: ["task", "fixed", "travel", "sleep"].includes(item.kind) };
    }
    return { ...item };
  }) }));
}

function toApiDayPlans(days: readonly DayPlan[]): DayPlan[] {
  return days.map((day) => ({
    date: day.date,
    items: day.items.map((item) => {
      const scheduleItem = { ...item } as typeof item & { reason_code?: unknown };
      delete scheduleItem.reason_code;
      return scheduleItem;
    }),
  }));
}

function fixtureBefore(now = "2026-10-05T18:00:00+09:00") {
  const context = createPlanningContext();
  const generated = generatePlans(context);
  if (!generated.ok) throw new Error(generated.infeasible.reason);
  context.now = now;
  context.style = "balanced";
  return { context, days: applyDisplayState(toApiDayPlans(generated.plans[1].days), now) };
}

describe("replan state_change", () => {
  it("12.7の疲労時デモを決定論的に再計画する", () => {
    const fixture = fixtureBefore();
    const beforeContext = structuredClone(fixture.context);
    const beforeDays = structuredClone(fixture.days);
    expect(beforeDays.flatMap((day) => day.items).every((item) => !("reason_code" in item))).toBe(true);
    const crossingEs = beforeDays[0].items.find((item) => item.task_id === "task_es_b" && item.start_at < fixture.context.now && fixture.context.now < item.end_at)!;
    expect(crossingEs).toMatchObject({ start_at: "2026-10-05T17:35:00+09:00", end_at: "2026-10-05T18:35:00+09:00", locked: true, status: "planned" });
    expect(beforeDays.flatMap((day) => day.items).filter((item) => item.kind === "task" && item.end_at <= fixture.context.now).every((item) => item.locked && item.status === "completed")).toBe(true);
    const result = replan(fixture.context, fixture.days, fatigueIntent("high"));
    expect(() => EngineReplanResultSchema.parse(result)).not.toThrow();
    if (!result.ok) throw new Error(result.infeasible.reason);
    expect(result.ok).toBe(true);
    const monday = result.proposal.after.items;
    const updatedMonday = result.updated_days.find((day) => day.date === "2026-10-05")!.items;
    expect(monday).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "free", start_at: "2026-10-05T18:00:00+09:00", end_at: "2026-10-05T18:30:00+09:00" }),
      expect.objectContaining({ kind: "task", task_id: "task_toeic_vocab", start_at: "2026-10-05T18:30:00+09:00", end_at: "2026-10-05T18:50:00+09:00" }),
      expect.objectContaining({ kind: "buffer", start_at: "2026-10-05T18:50:00+09:00", end_at: "2026-10-05T19:00:00+09:00" }),
    ]));
    expect(updatedMonday).toEqual(expect.arrayContaining([
      expect.objectContaining({ start_at: "2026-10-05T18:00:00+09:00", reason_code: "REST" }),
      expect.objectContaining({ start_at: "2026-10-05T18:30:00+09:00", reason_code: "TIRED_LIGHT" }),
    ]));
    expect(updatedMonday.every((item) => "reason_code" in item)).toBe(true);
    expect(updatedMonday.find((item) => item.title === "夕食")?.reason_code).toBeNull();
    expect(monday.find((item) => item.id === crossingEs.id)).toMatchObject({
      id: crossingEs.id,
      kind: "task",
      task_id: "task_es_b",
      start_at: "2026-10-05T17:35:00+09:00",
      end_at: "2026-10-05T18:00:00+09:00",
      locked: true,
      status: "completed",
    });
    const dinnerBefore = beforeDays[0].items.find((item) => item.title === "夕食");
    expect(monday.find((item) => item.id === dinnerBefore?.id)).toMatchObject({ id: dinnerBefore?.id, title: dinnerBefore?.title, start_at: dinnerBefore?.start_at, end_at: dinnerBefore?.end_at });
    const highIds = new Set(fixture.context.tasks.filter((task) => task.concentration === "high" || (task.goal_id && task.concentration === "medium")).map((task) => task.id));
    expect(monday.some((item) => item.kind === "task" && item.start_at >= fixture.context.now && item.task_id && highIds.has(item.task_id))).toBe(false);
    const replacement = result.proposal.changes.find((change) => change.change_type === "replaced" && change.before?.task_id === "task_toeic_listening");
    expect(replacement?.after.map((item) => [item.kind, item.start_at, item.end_at, item.task_id])).toEqual([
      ["free", "2026-10-05T18:00:00+09:00", "2026-10-05T18:30:00+09:00", null],
      ["task", "2026-10-05T18:30:00+09:00", "2026-10-05T18:50:00+09:00", "task_toeic_vocab"],
      ["buffer", "2026-10-05T18:50:00+09:00", "2026-10-05T19:00:00+09:00", null],
    ]);
    const crossingReplacement = result.proposal.changes.find((change) => change.change_type === "replaced" && change.before?.id === crossingEs.id);
    expect(crossingReplacement?.before).toMatchObject({
      id: crossingEs.id,
      kind: crossingEs.kind,
      title: crossingEs.title,
      start_at: crossingEs.start_at,
      end_at: crossingEs.end_at,
      task_id: crossingEs.task_id,
      location_id: crossingEs.location_id,
      locked: true,
      status: "planned",
      reason: crossingEs.reason,
    });
    expect(crossingReplacement?.after).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: crossingEs.id, start_at: crossingEs.start_at, end_at: fixture.context.now, status: "completed" }),
      expect.objectContaining({ kind: "free", start_at: "2026-10-05T18:00:00+09:00", end_at: "2026-10-05T18:30:00+09:00", reason: "まずは休憩をとって、疲れを回復します" }),
    ]));
    const movedEs = result.proposal.other_day_changes.filter((change) => change.change_type === "moved" && change.before?.id === crossingEs.id);
    expect(movedEs).toHaveLength(1);
    expect(movedEs[0].before).toMatchObject({ id: crossingEs.id, start_at: crossingEs.start_at, end_at: crossingEs.end_at });
    expect(movedEs[0].moved_to_date).not.toBeNull();
    expect(movedEs[0].reason).toContain("今日は避けました");
    expect(movedEs[0].after.filter((item) => item.kind === "task").reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0)).toBe(35);
    const movedListening = result.proposal.other_day_changes.find((change) => change.change_type === "moved" && change.before?.task_id === "task_toeic_listening");
    expect(movedListening?.moved_to_date).not.toBeNull();
    expect(movedListening?.after.filter((item) => item.kind === "task").reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0)).toBe(40);
    expect(result.proposal.summary_message).toMatch(/^お疲れさまです。今夜は軽めにして、ES作成（企業B）は.+曜、TOEICの残り40分は.+曜に回しました。夕食はそのままで、週6時間の目標とゼミレポート「地域経済の課題」の締切も守れます。$/);
    const afterDays = beforeDays.map((day) => result.updated_days.find((updated) => updated.date === day.date) ?? day);
    const validation = validatePlan(fixture.context, afterDays, "replan", { before: beforeDays, allowedInProgressTaskSplitIds: [crossingEs.id] });
    expect(validation.errors).toEqual([]);
    expect(validation.errors.some((issue) => issue.code === "LOCKED_ITEM_CHANGED")).toBe(false);
    const goalIds = new Set(fixture.context.tasks.filter((task) => task.goal_id === "goal_toeic").map((task) => task.id));
    const goalMinutes = afterDays.flatMap((day) => day.items).filter((item) => item.kind === "task" && item.task_id && goalIds.has(item.task_id)).reduce((sum, item) => sum + (new Date(item.end_at).getTime() - new Date(item.start_at).getTime()) / 60000, 0);
    expect(goalMinutes).toBe(360);
    expect(afterDays.flatMap((day) => day.items).filter((item) => item.task_id === "task_es_a").every((item) => item.end_at <= "2026-10-12T23:59:00+09:00")).toBe(true);
    expect(JSON.stringify(replan(fixture.context, fixture.days, fatigueIntent("high")))).toBe(JSON.stringify(result));
    expect(afterDays.flatMap((day) => day.items).filter((item) => ["task", "buffer"].includes(item.kind)).every((item) => {
      const date = item.start_at.slice(0, 10);
      return item.end_at <= `${date}T23:30:00+09:00`;
    })).toBe(true);
    expect(fixture.context).toEqual(beforeContext);
    expect(fixture.days).toEqual(beforeDays);
  }, 30_000);

  it("reason_code付きBeforeは既存値を保持し、nullable欠落だけをnullへ正規化する", () => {
    const fixture = fixtureBefore();
    const dinner = fixture.days[0].items.find((item) => item.title === "夕食")! as typeof fixture.days[0]["items"][number] & { reason_code?: "OPTIONAL_EXTRA" };
    dinner.reason_code = "OPTIONAL_EXTRA";
    const past = fixture.days[0].items.find((item) => item.kind === "sleep" && item.end_at <= fixture.context.now)! as unknown as Record<string, unknown>;
    for (const key of ["location_id", "task_id", "fixed_event_id", "fixed_category", "travel", "suggested_task_id", "reason", "reason_code"]) delete past[key];
    const before = structuredClone(fixture.days);

    const result = replan(fixture.context, fixture.days, fatigueIntent("high"));
    expect(() => EngineReplanResultSchema.parse(result)).not.toThrow();
    if (!result.ok) throw new Error(result.infeasible.reason);
    const monday = result.updated_days.find((day) => day.date === "2026-10-05")!.items;
    expect(monday.find((item) => item.id === dinner.id)?.reason_code).toBe("OPTIONAL_EXTRA");
    expect(monday.find((item) => item.id === String(past.id))).toMatchObject({
      location_id: null,
      task_id: null,
      fixed_event_id: null,
      fixed_category: null,
      travel: null,
      suggested_task_id: null,
      reason: null,
      reason_code: null,
    });
    expect(fixture.days).toEqual(before);
  }, 30_000);

  it("fatigue mediumでも同じ配置になりintent値は保持する", () => {
    const fixture = fixtureBefore();
    const high = replan(fixture.context, fixture.days, fatigueIntent("high"));
    const medium = replan(fixture.context, fixture.days, fatigueIntent("medium"));
    expect(high.ok && medium.ok).toBe(true);
    if (!high.ok || !medium.ok) return;
    expect(medium.proposal.intent.fatigue).toBe("medium");
    expect(medium.proposal.after.items).toEqual(high.proposal.after.items);
    expect(medium.updated_days).toEqual(high.updated_days);
  }, 30_000);

  it("進行中でも高集中ではないtaskは全体を保持する", () => {
    const fixture = fixtureBefore();
    const crossing = fixture.days[0].items.find((item) => item.task_id === "task_es_b" && item.start_at < fixture.context.now && fixture.context.now < item.end_at)!;
    const lightTask = fixture.context.tasks.find((task) => task.id === "task_notes")!;
    const unchanged = { ...crossing, title: lightTask.title, task_id: lightTask.id };
    fixture.days[0].items = fixture.days[0].items.map((item) => item.id === crossing.id ? unchanged : item);
    const result = replan(fixture.context, fixture.days, fatigueIntent("high"));
    if (!result.ok) throw new Error(result.infeasible.reason);
    expect(result.proposal.after.items.find((item) => item.id === unchanged.id)).toMatchObject({
      id: unchanged.id,
      start_at: unchanged.start_at,
      end_at: unchanged.end_at,
      task_id: lightTask.id,
      locked: true,
      status: "planned",
    });
    expect(result.proposal.changes.some((change) => change.before?.id === unchanged.id)).toBe(false);
  }, 30_000);

  it("nowをまたぐfreeの前半を元IDで保持する", () => {
    const fixture = fixtureBefore();
    const monday = fixture.days[0];
    const template = monday.items.find((item) => item.kind === "free")!;
    monday.items = [
      ...monday.items.filter((item) => item.end_at <= "2026-10-05T17:00:00+09:00" || item.title === "夕食"),
      { ...template, id: "crossing-free", start_at: "2026-10-05T17:00:00+09:00", end_at: "2026-10-05T19:00:00+09:00" },
      { ...template, id: "late-listening", kind: "task" as const, title: "TOEIC リスニング演習", task_id: "task_toeic_listening", start_at: "2026-10-05T19:45:00+09:00", end_at: "2026-10-05T20:45:00+09:00" },
      { ...template, id: "late-free", start_at: "2026-10-05T20:45:00+09:00", end_at: "2026-10-06T00:00:00+09:00" },
    ].sort((a, b) => a.start_at.localeCompare(b.start_at));
    const result = replan(fixture.context, fixture.days, fatigueIntent("high"));
    if (!result.ok) throw new Error(result.infeasible.reason);
    expect(result.ok).toBe(true);
    expect(result.proposal.after.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "crossing-free", start_at: "2026-10-05T17:00:00+09:00", end_at: "2026-10-05T18:00:00+09:00" }),
      expect.objectContaining({ start_at: "2026-10-05T18:00:00+09:00", end_at: "2026-10-05T18:30:00+09:00" }),
    ]));
    expect(result.proposal.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_type: "replaced", before: expect.objectContaining({ id: "crossing-free" }) }),
    ]));
  }, 30_000);

  it("最初の空きが30分未満なら後続空きへ休憩と軽作業を置く", () => {
    const fixture = fixtureBefore("2026-10-05T18:40:00+09:00");
    const result = replan(fixture.context, fixture.days, fatigueIntent("high"));
    if (!result.ok) throw new Error(result.infeasible.reason);
    const monday = result.updated_days.find((day) => day.date === "2026-10-05")!.items;
    expect(monday).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "free", start_at: "2026-10-05T19:45:00+09:00", end_at: "2026-10-05T20:15:00+09:00", reason_code: "REST" }),
      expect.objectContaining({ kind: "task", task_id: "task_toeic_vocab", start_at: "2026-10-05T20:15:00+09:00", end_at: "2026-10-05T20:35:00+09:00", reason_code: "TIRED_LIGHT" }),
      expect.objectContaining({ kind: "buffer", start_at: "2026-10-05T20:35:00+09:00", end_at: "2026-10-05T20:45:00+09:00" }),
    ]));
  }, 30_000);

  it("今週締切の高集中taskを締切前へ移し、空きがなければ不成立にする", () => {
    const fixture = fixtureBefore();
    const monday = fixture.days[0];
    const late = monday.items.find((item) => item.task_id === "task_stats_hw" && item.start_at === "2026-10-05T21:30:00+09:00")!;
    monday.items = monday.items.map((item) => item.id === late.id ? { ...item, title: "ゼミレポート「地域経済の課題」", task_id: "task_report" } : item);
    const success = replan(fixture.context, fixture.days, fatigueIntent("high"));
    if (!success.ok) throw new Error(success.infeasible.reason);
    const moved = success.proposal.other_day_changes.find((change) => change.before?.id === late.id);
    expect(moved?.moved_to_date).toMatch(/^2026-10-0[6-8]$/);
    expect(moved?.after.some((item) => item.task_id === "task_report")).toBe(true);

    const blockedDays = structuredClone(fixture.days);
    for (const day of blockedDays.filter((entry) => entry.date >= "2026-10-06" && entry.date <= "2026-10-08")) {
      day.items = day.items.filter((item) => item.kind !== "free");
    }
    const blocked = replan(fixture.context, blockedDays, fatigueIntent("high"));
    expect(blocked).toMatchObject({ ok: false, infeasible: { feasible: false } });
  }, 30_000);

  it("進行中でない来週締切taskをNEXT_WEEKとして記録する", () => {
    const fixture = fixtureBefore();
    const result = replan(fixture.context, fixture.days, fatigueIntent("high"));
    if (!result.ok) throw new Error(result.infeasible.reason);
    expect(result.proposal.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_type: "removed", before: expect.objectContaining({ task_id: "task_stats_hw" }), reason: expect.stringContaining("来週") }),
    ]));
  }, 30_000);
});

describe("replan intents", () => {
  it("未実装intent・preference_change・低疲労を安定した不成立結果で返す", () => {
    const fixture = fixtureBefore();
    const beforeDays = structuredClone(fixture.days);
    const intents: ReplanProposal["intent"][] = [
      { type: "task_change", fatigue: null, task_changes: [{ task_id: "task_toeic_listening", action: "skip" }], new_fixed_events: [], preference_changes: [] },
      { type: "new_fixed_event", fatigue: null, task_changes: [], new_fixed_events: [], preference_changes: [] },
      { type: "preference_change", fatigue: null, task_changes: [], new_fixed_events: [], preference_changes: ["夜を空ける"] },
      { ...fatigueIntent("high"), fatigue: "low" },
      { ...fatigueIntent("high"), fatigue: null },
    ];
    const results = intents.map((intent) => replan(fixture.context, fixture.days, intent));
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(JSON.stringify(intents.map((intent) => replan(fixture.context, fixture.days, intent)))).toBe(JSON.stringify(results));
    expect(fixture.days).toEqual(beforeDays);
    const crossing = fixture.days[0].items.find((item) => item.start_at < fixture.context.now && fixture.context.now < item.end_at && item.kind === "task");
    expect(crossing).toMatchObject({ locked: true, status: "planned" });
  }, 30_000);
});
