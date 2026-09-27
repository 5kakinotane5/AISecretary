import { describe, expect, it } from "vitest";
import { diffMinutesExact } from "@/lib/datetime";
import { EngineReplanResultSchema, type DayPlan, type FixedEvent, type ReplanProposal } from "@/lib/schemas";
import { generatePlans } from "../generate";
import { replan } from "../replan";
import { validatePlan } from "../validate";
import { createPlanningContext } from "./fixtures";

const fatigueIntent = (fatigue: "high" | "medium"): ReplanProposal["intent"] => ({ type: "state_change", fatigue, task_changes: [], new_fixed_events: [], preference_changes: [] });
const fixedIntent = (event: FixedEvent): ReplanProposal["intent"] => ({ type: "new_fixed_event", fatigue: null, task_changes: [], new_fixed_events: [event], preference_changes: [] });
const taskIntent = (task_id: string, action: "postpone" | "skip" | "shorten"): ReplanProposal["intent"] => ({ type: "task_change", fatigue: null, task_changes: [{ task_id, action }], new_fixed_events: [], preference_changes: [] });

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
    // 休憩は切った ES の replaced に、単語とそのバッファはリスニングの replaced にだけ入る（12.5。同じ項目を2つの変更に重ねない）
    expect(replacement?.after.map((item) => [item.kind, item.start_at, item.end_at, item.task_id])).toEqual([
      ["task", "2026-10-05T18:30:00+09:00", "2026-10-05T18:50:00+09:00", "task_toeic_vocab"],
      ["buffer", "2026-10-05T18:50:00+09:00", "2026-10-05T19:00:00+09:00", null],
    ]);
    expect(replacement?.reason).toContain("TOEIC 単語に切り替えました");
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
    expect(crossingReplacement?.after.map((item) => [item.kind, item.start_at, item.end_at])).toEqual([
      ["task", crossingEs.start_at, fixture.context.now],
      ["free", "2026-10-05T18:00:00+09:00", "2026-10-05T18:30:00+09:00"],
    ]);
    expect(crossingReplacement?.after[0]).toMatchObject({ id: crossingEs.id, status: "completed" });
    expect(crossingReplacement?.reason).toBe("まずは休憩をとって、疲れを回復します");
    const todayAfterIds = result.proposal.changes.flatMap((change) => change.after.map((item) => item.id));
    expect(new Set(todayAfterIds).size).toBe(todayAfterIds.length);
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
    // 自由時間の replaced は前半＋休憩、リスニングの replaced は単語＋バッファ（同じ項目を重ねない）
    const crossingFree = result.proposal.changes.find((change) => change.before?.id === "crossing-free");
    expect(crossingFree?.after.map((item) => item.kind)).toEqual(["free", "free"]);
    const listening = result.proposal.changes.find((change) => change.change_type === "replaced" && change.before?.id === "late-listening");
    expect(listening?.after.map((item) => [item.kind, item.task_id])).toEqual([["task", "task_toeic_vocab"], ["buffer", null]]);
    const todayAfterIds = result.proposal.changes.flatMap((change) => change.after.map((item) => item.id));
    expect(new Set(todayAfterIds).size).toBe(todayAfterIds.length);
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
  it("未実装preference_change・低疲労を安定した不成立結果で返す", () => {
    const fixture = fixtureBefore();
    const beforeDays = structuredClone(fixture.days);
    const intents: ReplanProposal["intent"][] = [
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

describe("replan new_fixed_event", () => {
  it("20:00〜21:00の予定を追加し、重なるtaskを移してfreeを分割する", () => {
    const fixture = fixtureBefore();
    const event: FixedEvent = {
      id: "fixed_new_meeting",
      title: "オンライン会議",
      category: "other",
      location_id: null,
      start_at: "2026-10-05T20:00:00+09:00",
      end_at: "2026-10-05T21:00:00+09:00",
      recurrence: null,
    };
    const before = structuredClone(fixture.days);
    const result = replan(fixture.context, fixture.days, fixedIntent(event));
    expect(() => EngineReplanResultSchema.parse(result)).not.toThrow();
    if (!result.ok) throw new Error(result.infeasible.reason);
    const monday = result.proposal.after.items;
    expect(monday).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: event.id,
        kind: "fixed",
        title: event.title,
        start_at: event.start_at,
        end_at: event.end_at,
        location_id: null,
        fixed_event_id: event.id,
        locked: true,
        reason: "20:00からの予定を入れました",
      }),
    ]));
    expect(result.updated_days.flatMap((day) => day.items).find((item) => item.id === event.id)).toMatchObject({ reason_code: "FIXED_EVENT_ADDED" });
    expect(monday.filter((item) => item.kind === "free").every((item) => item.end_at <= event.start_at || item.start_at >= event.end_at)).toBe(true);
    expect(monday.some((item) => item.id !== event.id && item.start_at < event.end_at && event.start_at < item.end_at)).toBe(false);
    expect(result.proposal.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_type: "added", before: null, after: [expect.objectContaining({ id: event.id })], reason: "20:00からの予定を入れました" }),
      expect.objectContaining({ change_type: "moved", before: expect.objectContaining({ kind: "task" }), after: [], moved_to_date: expect.any(String) }),
    ]));
    expect(result.proposal.other_day_changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_type: "moved", before: expect.objectContaining({ kind: "task" }), after: expect.arrayContaining([expect.objectContaining({ kind: "task" })]), moved_to_date: expect.any(String) }),
    ]));
    expect(result.proposal.summary_message).toBe("20:00からの予定を入れ、TOEICの残り60分は日曜に移しました。");
    const afterDays = before.map((day) => result.updated_days.find((updated) => updated.date === day.date) ?? day);
    const validation = validatePlan({ ...fixture.context, fixed_events: [...fixture.context.fixed_events, event] }, afterDays, "replan", { before });
    expect(validation.errors).toEqual([]);
    expect(validation.errors.some((issue) => issue.code === "LOCKED_ITEM_CHANGED")).toBe(false);
    expect(fixture.days).toEqual(before);
    expect(JSON.stringify(replan(fixture.context, fixture.days, fixedIntent(event)))).toBe(JSON.stringify(result));
  }, 30_000);

  it("freeの中へ予定を追加すると前後へ分割する", () => {
    const fixture = fixtureBefore();
    const event: FixedEvent = {
      id: "fixed_late_call",
      title: "電話",
      category: "other",
      location_id: null,
      start_at: "2026-10-05T23:15:00+09:00",
      end_at: "2026-10-05T23:45:00+09:00",
      recurrence: null,
    };
    const result = replan(fixture.context, fixture.days, fixedIntent(event));
    if (!result.ok) throw new Error(result.infeasible.reason);
    expect(result.proposal.after.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "free", start_at: "2026-10-05T23:00:00+09:00", end_at: event.start_at }),
      expect.objectContaining({ kind: "fixed", id: event.id, start_at: event.start_at, end_at: event.end_at }),
      expect.objectContaining({ kind: "free", start_at: event.end_at, end_at: "2026-10-06T00:00:00+09:00" }),
    ]));
    expect(result.proposal.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_type: "replaced", before: expect.objectContaining({ kind: "free", start_at: "2026-10-05T23:00:00+09:00" }) }),
    ]));
  }, 30_000);

  it("夕食・進行中task・locked項目との重複を拒否する", () => {
    const fixture = fixtureBefore();
    const makeEvent = (id: string, start_at: string, end_at: string): FixedEvent => ({ id, title: "追加予定", category: "other", location_id: null, start_at, end_at, recurrence: null });
    const dinner = replan(fixture.context, fixture.days, fixedIntent(makeEvent("fixed_dinner_overlap", "2026-10-05T19:00:00+09:00", "2026-10-05T20:00:00+09:00")));
    expect(dinner).toMatchObject({ ok: false, infeasible: { feasible: false, reason: expect.stringContaining("夕食") } });

    const crossing = fixture.days[0].items.find((item) => item.kind === "task" && item.start_at < fixture.context.now && fixture.context.now < item.end_at)!;
    const progress = replan(fixture.context, fixture.days, fixedIntent(makeEvent("fixed_progress_overlap", "2026-10-05T18:05:00+09:00", crossing.end_at)));
    expect(progress).toMatchObject({ ok: false, infeasible: { feasible: false, reason: expect.stringContaining(crossing.title) } });
    expect(fixture.days[0].items.find((item) => item.id === crossing.id)).toEqual(crossing);

    const withLocked = structuredClone(fixture.days);
    const template = withLocked[0].items.find((item) => item.kind === "free" && item.start_at >= "2026-10-05T21:00:00+09:00")!;
    const locked = { ...template, id: "locked-future", start_at: "2026-10-05T21:00:00+09:00", end_at: "2026-10-05T21:30:00+09:00", locked: true };
    withLocked[0].items = [...withLocked[0].items.filter((item) => item.end_at <= locked.start_at || item.start_at >= locked.end_at), locked].sort((a, b) => a.start_at.localeCompare(b.start_at));
    const blocked = replan(fixture.context, withLocked, fixedIntent(makeEvent("fixed_locked_overlap", locked.start_at, locked.end_at)));
    expect(blocked).toMatchObject({ ok: false, infeasible: { feasible: false, reason: expect.stringContaining(locked.title) } });

    for (const kind of ["fixed", "travel", "sleep"] as const) {
      const protectedDays = structuredClone(fixture.days);
      const base = protectedDays[0].items.find((item) => item.kind === "free" && item.start_at >= "2026-10-05T21:00:00+09:00")!;
      const protectedItem = {
        ...base,
        id: `protected-${kind}`,
        kind,
        title: `保護対象${kind}`,
        start_at: "2026-10-05T21:00:00+09:00",
        end_at: "2026-10-05T21:30:00+09:00",
        locked: true,
      };
      protectedDays[0].items = [...protectedDays[0].items.filter((item) => item.end_at <= protectedItem.start_at || item.start_at >= protectedItem.end_at), protectedItem].sort((a, b) => a.start_at.localeCompare(b.start_at));
      const result = replan(fixture.context, protectedDays, fixedIntent(makeEvent(`fixed_${kind}_overlap`, protectedItem.start_at, protectedItem.end_at)));
      expect(result).toMatchObject({ ok: false, infeasible: { feasible: false, reason: expect.stringContaining(protectedItem.title) } });
    }
  }, 30_000);
});

describe("replan task_change", () => {
  it("疲れた後の「今日はもう勉強したくない」：20分の単語を別の日へ移して週360分を保つ", () => {
    const fixture = fixtureBefore();
    const tired = replan(fixture.context, fixture.days, fatigueIntent("high"));
    if (!tired.ok) throw new Error(tired.infeasible.reason);
    const afterTired = fixture.days.map((day) => tired.updated_days.find((updated) => updated.date === day.date) ?? day);
    const days = applyDisplayState(toApiDayPlans(afterTired), fixture.context.now);
    const vocab = days[0].items.find((item) => item.task_id === "task_toeic_vocab" && item.start_at >= fixture.context.now)!;
    expect(diffMinutesExact(vocab.start_at, vocab.end_at)).toBe(20);
    const result = replan(fixture.context, days, taskIntent("task_toeic_vocab", "postpone"));
    if (!result.ok) throw new Error(result.infeasible.reason);
    const moved = result.proposal.other_day_changes.find((change) => change.change_type === "moved" && change.before?.task_id === "task_toeic_vocab");
    expect(moved?.moved_to_date).not.toBeNull();
    expect(moved?.after.filter((item) => item.kind === "task").reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0)).toBe(20);
    const finalDays = days.map((day) => result.updated_days.find((updated) => updated.date === day.date) ?? day);
    expect(finalDays[0].items.some((item) => item.kind === "task" && item.start_at >= fixture.context.now)).toBe(false);
    const goalIds = new Set(fixture.context.tasks.filter((task) => task.goal_id === "goal_toeic").map((task) => task.id));
    expect(finalDays.flatMap((day) => day.items).filter((item) => item.kind === "task" && item.task_id && goalIds.has(item.task_id)).reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0)).toBe(360);
  }, 30_000);

  it("目標taskをpostponeし、元時間をfreeへ戻して週360分を維持する", () => {
    const fixture = fixtureBefore();
    const before = structuredClone(fixture.days);
    const source = before[0].items.find((item) => item.task_id === "task_toeic_listening" && item.start_at >= fixture.context.now)!;
    const result = replan(fixture.context, fixture.days, taskIntent("task_toeic_listening", "postpone"));
    expect(() => EngineReplanResultSchema.parse(result)).not.toThrow();
    if (!result.ok) throw new Error(result.infeasible.reason);
    expect(result.proposal.after.items.some((item) => item.id === source.id)).toBe(false);
    expect(result.proposal.after.items.some((item) => item.kind === "free" && item.start_at <= source.start_at && item.end_at >= source.end_at)).toBe(true);
    const todayMove = result.proposal.changes.find((change) => change.change_type === "moved" && change.before?.id === source.id);
    expect(todayMove).toMatchObject({ after: [], moved_to_date: expect.any(String), reason: expect.stringContaining("回しました") });
    const otherMove = result.proposal.other_day_changes.find((change) => change.before?.id === source.id);
    expect(otherMove).toMatchObject({ change_type: "moved", moved_to_date: todayMove?.moved_to_date, after: expect.arrayContaining([expect.objectContaining({ task_id: "task_toeic_listening" })]) });
    const afterDays = before.map((day) => result.updated_days.find((updated) => updated.date === day.date) ?? day);
    const goalIds = new Set(fixture.context.tasks.filter((task) => task.goal_id === "goal_toeic").map((task) => task.id));
    expect(afterDays.flatMap((day) => day.items).filter((item) => item.kind === "task" && item.task_id && goalIds.has(item.task_id)).reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0)).toBe(360);
    expect(result.proposal.summary_message).toContain("TOEIC リスニング演習を");
    expect(validatePlan(fixture.context, afterDays, "replan", { before }).errors).toEqual([]);
    expect(fixture.days).toEqual(before);
    expect(JSON.stringify(replan(fixture.context, fixture.days, taskIntent("task_toeic_listening", "postpone")))).toBe(JSON.stringify(result));
  }, 30_000);

  it("今週締切taskをpostponeして締切前の別日へ移す", () => {
    const fixture = fixtureBefore();
    const source = fixture.days[0].items.find((item) => item.task_id === "task_stats_hw" && item.start_at >= fixture.context.now)!;
    fixture.days[0].items = fixture.days[0].items.map((item) => item.id === source.id ? { ...item, task_id: "task_report", title: "ゼミレポート「地域経済の課題」" } : item);
    const result = replan(fixture.context, fixture.days, taskIntent("task_report", "postpone"));
    if (!result.ok) throw new Error(result.infeasible.reason);
    const moved = result.proposal.other_day_changes.find((change) => change.before?.id === source.id)!;
    expect(moved.moved_to_date).toMatch(/^2026-10-0[6-8]$/);
    expect(moved.after).toEqual(expect.arrayContaining([expect.objectContaining({ task_id: "task_report" })]));
    expect(moved.after.filter((item) => item.kind === "task").every((item) => item.end_at <= "2026-10-09T23:59:00+09:00")).toBe(true);
    expect(result.proposal.summary_message).toContain("締切（10/9）には間に合います。");
  }, 30_000);

  it("任意taskのskipは今週から外しUSER_SKIPPEDを記録する", () => {
    const fixture = fixtureBefore();
    const source = fixture.days[0].items.find((item) => item.task_id === "task_stats_hw" && item.start_at >= fixture.context.now)!;
    fixture.days[0].items = fixture.days[0].items.map((item) => item.id === source.id ? { ...item, task_id: "task_research", title: "企業研究" } : item);
    const result = replan(fixture.context, fixture.days, taskIntent("task_research", "skip"));
    if (!result.ok) throw new Error(result.infeasible.reason);
    expect(result.proposal.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_type: "removed", before: expect.objectContaining({ id: source.id }), after: [], moved_to_date: null, reason: "企業研究は今週はお休みにしました" }),
    ]));
    expect(result.proposal.other_day_changes.some((change) => change.before?.id === source.id)).toBe(false);
    expect(result.proposal.summary_message).toBe("企業研究は今週はお休みにしました。");
  }, 30_000);

  it("60分の目標taskを30分へshortenし、残り30分を別日へ移す", () => {
    const fixture = fixtureBefore();
    const before = structuredClone(fixture.days);
    const source = before[0].items.find((item) => item.task_id === "task_toeic_listening" && item.start_at >= fixture.context.now)!;
    const result = replan(fixture.context, fixture.days, taskIntent("task_toeic_listening", "shorten"));
    if (!result.ok) throw new Error(result.infeasible.reason);
    const shortened = result.proposal.changes.find((change) => change.change_type === "shortened" && change.before?.id === source.id)!;
    expect(shortened.after).toEqual([expect.objectContaining({ id: source.id, start_at: source.start_at, end_at: "2026-10-05T20:30:00+09:00" })]);
    expect(shortened.reason).toBe("TOEIC リスニング演習を30分に短くしました");
    const moved = result.proposal.other_day_changes.find((change) => change.before?.id === source.id)!;
    expect(moved.after.filter((item) => item.kind === "task").reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0)).toBe(30);
    expect(result.proposal.summary_message).toMatch(/^TOEIC リスニング演習を30分に短くしました。残りは.+曜に回しました。$/);
    const afterDays = before.map((day) => result.updated_days.find((updated) => updated.date === day.date) ?? day);
    const goalIds = new Set(fixture.context.tasks.filter((task) => task.goal_id === "goal_toeic").map((task) => task.id));
    expect(afterDays.flatMap((day) => day.items).filter((item) => item.kind === "task" && item.task_id && goalIds.has(item.task_id)).reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0)).toBe(360);
    expect(validatePlan(fixture.context, afterDays, "replan", { before }).errors).toEqual([]);
  }, 30_000);

  it("skipでも締切・目標taskは削除せず別日へ移す", () => {
    const fixture = fixtureBefore();
    const goalSource = fixture.days[0].items.find((item) => item.task_id === "task_toeic_listening" && item.start_at >= fixture.context.now)!;
    const goalResult = replan(fixture.context, fixture.days, taskIntent("task_toeic_listening", "skip"));
    if (!goalResult.ok) throw new Error(goalResult.infeasible.reason);
    expect(goalResult.proposal.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_type: "moved", before: expect.objectContaining({ id: goalSource.id }) }),
    ]));
    expect(goalResult.proposal.changes.some((change) => change.change_type === "removed" && change.before?.id === goalSource.id)).toBe(false);

    const deadlineDays = structuredClone(fixture.days);
    const deadlineSource = deadlineDays[0].items.find((item) => item.task_id === "task_stats_hw" && item.start_at >= fixture.context.now)!;
    deadlineDays[0].items = deadlineDays[0].items.map((item) => item.id === deadlineSource.id ? { ...item, task_id: "task_report", title: "ゼミレポート「地域経済の課題」" } : item);
    const deadlineResult = replan(fixture.context, deadlineDays, taskIntent("task_report", "skip"));
    if (!deadlineResult.ok) throw new Error(deadlineResult.infeasible.reason);
    expect(deadlineResult.proposal.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_type: "moved", before: expect.objectContaining({ id: deadlineSource.id }) }),
    ]));
    expect(deadlineResult.proposal.changes.some((change) => change.change_type === "removed" && change.before?.id === deadlineSource.id)).toBe(false);
  }, 30_000);

  it("65分は30分へ切り下げ、半分が30分未満なら今日から除去する", () => {
    const fixture = fixtureBefore();
    const source = fixture.days[0].items.find((item) => item.task_id === "task_toeic_listening" && item.start_at >= fixture.context.now)!;
    const buffer = fixture.days[0].items.find((item) => item.kind === "buffer" && item.start_at === source.end_at)!;
    const precedingBuffer = fixture.days[0].items.find((item) => item.kind === "buffer" && item.end_at === source.start_at)!;
    fixture.days[0].items = fixture.days[0].items.filter((item) => item.id !== precedingBuffer.id).map((item) => {
      if (item.id === source.id) return { ...item, start_at: "2026-10-05T19:45:00+09:00", end_at: "2026-10-05T20:50:00+09:00" };
      if (item.id === buffer.id) return { ...item, start_at: "2026-10-05T20:50:00+09:00", end_at: "2026-10-05T21:05:00+09:00" };
      return item;
    }).sort((a, b) => a.start_at.localeCompare(b.start_at));
    fixture.context.goal_week_target_minutes.goal_toeic = 365;
    const sixtyFive = replan(fixture.context, fixture.days, taskIntent("task_toeic_listening", "shorten"));
    if (!sixtyFive.ok) throw new Error(sixtyFive.infeasible.reason);
    expect(sixtyFive.proposal.changes.find((change) => change.change_type === "shortened" && change.before?.id === source.id)?.after).toEqual([
      expect.objectContaining({ start_at: "2026-10-05T19:45:00+09:00", end_at: "2026-10-05T20:15:00+09:00" }),
    ]);

    const smallFixture = fixtureBefore();
    const smallSource = smallFixture.days[0].items.find((item) => item.task_id === "task_stats_hw" && item.start_at >= smallFixture.context.now)!;
    smallFixture.days[0].items = smallFixture.days[0].items.map((item) => item.id === smallSource.id ? { ...item, task_id: "task_research", title: "企業研究" } : item);
    const small = replan(smallFixture.context, smallFixture.days, taskIntent("task_research", "shorten"));
    if (!small.ok) throw new Error(small.infeasible.reason);
    expect(small.proposal.changes.find((change) => change.change_type === "shortened" && change.before?.id === smallSource.id)?.after).toEqual([]);
    expect(small.proposal.other_day_changes.find((change) => change.before?.id === smallSource.id)?.after).toEqual(expect.arrayContaining([expect.objectContaining({ task_id: "task_research" })]));
  }, 30_000);

  it("必須taskの移動先がなければ成立不可にする", () => {
    const fixture = fixtureBefore();
    for (const day of fixture.days.filter((entry) => entry.date > "2026-10-05")) day.items = day.items.filter((item) => item.kind !== "free");
    expect(replan(fixture.context, fixture.days, taskIntent("task_toeic_listening", "postpone"))).toMatchObject({
      ok: false,
      infeasible: { feasible: false, reason: expect.stringContaining("目標時間") },
    });
  }, 30_000);

  it("進行中・locked・completedだけの対象は保持し、矛盾actionを拒否する", () => {
    const fixture = fixtureBefore();
    const crossing = fixture.days[0].items.find((item) => item.task_id === "task_es_b" && item.start_at < fixture.context.now && fixture.context.now < item.end_at)!;
    const before = structuredClone(fixture.days);
    const protectedResult = replan(fixture.context, fixture.days, taskIntent("task_es_b", "skip"));
    expect(protectedResult).toMatchObject({ ok: false, infeasible: { feasible: false, reason: expect.stringContaining("変更できる今後の予定がありません") } });
    expect(fixture.days[0].items.find((item) => item.id === crossing.id)).toEqual(crossing);
    expect(fixture.days).toEqual(before);

    const contradictory: ReplanProposal["intent"] = {
      type: "task_change",
      fatigue: null,
      task_changes: [
        { task_id: "task_toeic_listening", action: "postpone" },
        { task_id: "task_toeic_listening", action: "skip" },
      ],
      new_fixed_events: [],
      preference_changes: [],
    };
    expect(replan(fixture.context, fixture.days, contradictory)).toMatchObject({ ok: false, infeasible: { feasible: false, reason: expect.stringContaining("変更内容を1つ") } });
    expect(replan(fixture.context, fixture.days, taskIntent("missing-task", "postpone"))).toMatchObject({ ok: false, infeasible: { feasible: false, reason: "指定されたタスクが見つかりません。" } });
  }, 30_000);
});
