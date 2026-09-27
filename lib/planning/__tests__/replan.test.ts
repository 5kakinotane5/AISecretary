import { describe, expect, it } from "vitest";
import { diffMinutesExact } from "@/lib/datetime";
import { EngineReplanResultSchema, type ReplanProposal } from "@/lib/schemas";
import { generatePlans } from "../generate";
import { replan } from "../replan";
import { validatePlan } from "../validate";
import { createPlanningContext } from "./fixtures";

const fatigueIntent = (fatigue: "high" | "medium"): ReplanProposal["intent"] => ({ type: "state_change", fatigue, task_changes: [], new_fixed_events: [], preference_changes: [] });

function fixtureBefore() {
  const context = createPlanningContext();
  const generated = generatePlans(context);
  if (!generated.ok) throw new Error(generated.infeasible.reason);
  return { context, days: generated.plans[1].days };
}

describe("replan state_change", () => {
  it("12.7の疲労時デモを決定論的に再計画する", () => {
    const fixture = fixtureBefore();
    fixture.context.now = "2026-10-05T18:00:00+09:00";
    fixture.context.style = "balanced";
    const beforeContext = structuredClone(fixture.context);
    const beforeDays = structuredClone(fixture.days);
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
    const movedListening = result.proposal.other_day_changes.find((change) => change.change_type === "moved" && change.before?.task_id === "task_toeic_listening");
    expect(movedListening?.moved_to_date).not.toBeNull();
    expect(movedListening?.after.filter((item) => item.kind === "task").reduce((sum, item) => sum + diffMinutesExact(item.start_at, item.end_at), 0)).toBe(40);
    expect(result.proposal.summary_message).toMatch(/^お疲れさまです。今夜は軽めにして、TOEICの残り40分は.+曜に回しました。夕食はそのままで、週6時間の目標とゼミレポート「地域経済の課題」の締切も守れます。$/);
    const afterDays = beforeDays.map((day) => result.updated_days.find((updated) => updated.date === day.date) ?? day);
    expect(validatePlan(fixture.context, afterDays, "replan", { before: result.proposal.before.date ? beforeDays : beforeDays }).errors).toEqual([]);
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

  it("fatigue mediumでも同じ配置になりintent値は保持する", () => {
    const fixture = fixtureBefore();
    fixture.context.now = "2026-10-05T18:00:00+09:00";
    fixture.context.style = "balanced";
    const high = replan(fixture.context, fixture.days, fatigueIntent("high"));
    const medium = replan(fixture.context, fixture.days, fatigueIntent("medium"));
    expect(high.ok && medium.ok).toBe(true);
    if (!high.ok || !medium.ok) return;
    expect(medium.proposal.intent.fatigue).toBe("medium");
    expect(medium.proposal.after.items).toEqual(high.proposal.after.items);
    expect(medium.updated_days).toEqual(high.updated_days);
  }, 30_000);

  it("nowをまたぐfreeの前半を元IDで保持する", () => {
    const fixture = fixtureBefore();
    fixture.context.now = "2026-10-05T18:00:00+09:00"; fixture.context.style = "balanced";
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
    const fixture = fixtureBefore();
    fixture.context.now = "2026-10-05T18:40:00+09:00";
    fixture.context.style = "balanced";
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
    fixture.context.now = "2026-10-05T18:00:00+09:00";
    fixture.context.style = "balanced";
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

  it("来週締切で今週へ置かないtaskをNEXT_WEEKとして記録する", () => {
    const fixture = fixtureBefore();
    fixture.context.now = "2026-10-05T18:00:00+09:00";
    fixture.context.style = "balanced";
    const result = replan(fixture.context, fixture.days, fatigueIntent("high"));
    if (!result.ok) throw new Error(result.infeasible.reason);
    expect(result.proposal.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_type: "removed", before: expect.objectContaining({ task_id: "task_es_b" }), reason: expect.stringContaining("来週") }),
    ]));
  }, 30_000);
});

describe("replan intents", () => {
  it("未実装intent・preference_change・低疲労を安定した不成立結果で返す", () => {
    const fixture = fixtureBefore(); fixture.context.now = "2026-10-05T18:00:00+09:00"; fixture.context.style = "balanced";
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
  }, 30_000);
});
