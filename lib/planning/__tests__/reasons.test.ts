import { describe, expect, it } from "vitest";
import { ScheduleItemSchema, type DayPlan, type ReplanChange, type ReplanProposal } from "@/lib/schemas";
import { computeTaskPriorities } from "../priority";
import { addBufferSuggestions, applyGenerationReasons, buildExplanation, buildReplanSummary, replanReason, timeBandLabel } from "../reasons";
import { createPlanningContext } from "./fixtures";

const item = (overrides: Record<string, unknown> = {}) => ScheduleItemSchema.parse({ id: "x", kind: "free", title: "自由時間", start_at: "2026-10-05T08:00:00+09:00", end_at: "2026-10-05T09:00:00+09:00", location_id: "loc_home", task_id: null, fixed_event_id: null, fixed_category: null, travel: null, suggested_task_id: null, locked: false, status: "planned", reason: null, ...overrides });

describe("reasons", () => {
  it.each([["09:59", "朝"], ["10:00", "午前"], ["12:00", "午後"], ["17:00", "夕方"], ["19:00", "夜"]])("%sは%s", (time, label) => expect(timeBandLabel(`2026-10-05T${time}:00+09:00`)).toBe(label));

  it("taskへ生成理由を付け、非taskはnullにする", () => {
    const context = createPlanningContext();
    const days: DayPlan[] = [{ date: "2026-10-05", items: [item({ id: "task", kind: "task", title: "レポート", task_id: "task_report" }), item({ id: "free" })] }];
    const result = applyGenerationReasons(context, days, "intensive");
    expect(result[0].items[0]).toMatchObject({ reason_code: "DEADLINE_EARLY" });
    expect(result[0].items[0].reason).toContain("締切");
    expect(result[0].items[1]).toMatchObject({ reason_code: null, reason: null });
    expect(buildExplanation(context, days, "intensive")).toContain("早め");
  });

  it("bufferへ軽作業候補を最大1件付ける", () => {
    const context = createPlanningContext();
    const days: DayPlan[] = [{ date: "2026-10-05", items: [item({ kind: "buffer", title: "バッファ", end_at: "2026-10-05T08:30:00+09:00" })] }];
    const suggested = addBufferSuggestions(context, days, computeTaskPriorities(context, "2026-10-05"));
    const reasoned = applyGenerationReasons(context, suggested, "balanced");
    expect(reasoned[0].items[0].suggested_task_id).not.toBeNull();
    expect(reasoned[0].items[0]).toMatchObject({ reason_code: "LIGHT_IN_BUFFER" });
  });

  it("state_changeの理由テンプレートを設計文言どおり返す", () => {
    const context = createPlanningContext();
    const listening = context.tasks.find((task) => task.id === "task_toeic_listening")!;
    const vocab = context.tasks.find((task) => task.id === "task_toeic_vocab")!;
    expect(replanReason("REST", { context })).toBe("まずは休憩をとって、疲れを回復します");
    expect(replanReason("TIRED_LIGHT", { context, task: listening, replacement: vocab })).toBe("疲れているため、集中力が必要なTOEIC リスニング演習を、短時間でできるTOEIC 単語に切り替えました");
    expect(replanReason("GOAL_CARRYOVER", { context, task: listening, date: "2026-10-06" })).toBe("週6時間の目標を保つため、火曜に振り替えました");
    expect(replanReason("BUFFER_MERGED", { context })).toBe("作業がなくなったため、自由時間にまとめました");
    expect(replanReason("FREE_EXTENDED", { context })).toBe("ゆっくり休めるようにしました");
  });

  it("state_changeの要約へ移動量・曜日・固定予定・締切を差し込む", () => {
    const context = createPlanningContext();
    context.now = "2026-10-05T18:00:00+09:00";
    const before = item({ kind: "task", title: "TOEIC リスニング演習", task_id: "task_toeic_listening", start_at: "2026-10-05T20:00:00+09:00", end_at: "2026-10-05T21:00:00+09:00" });
    const after = item({ id: "moved", kind: "task", title: before.title, task_id: before.task_id, start_at: "2026-10-06T18:00:00+09:00", end_at: "2026-10-06T18:40:00+09:00" });
    const change: ReplanChange = { change_type: "moved", before, after: [after], moved_to_date: "2026-10-06", reason: "移動" };
    const intent: ReplanProposal["intent"] = { type: "state_change", fatigue: "high", task_changes: [], new_fixed_events: [], preference_changes: [] };
    const dinner = item({ id: "dinner", kind: "fixed", title: "夕食", fixed_event_id: "fx_mon_dinner", fixed_category: "meal", locked: true, start_at: "2026-10-05T19:00:00+09:00", end_at: "2026-10-05T19:45:00+09:00" });
    expect(buildReplanSummary(context, intent, [], [change], [dinner])).toBe("お疲れさまです。今夜は軽めにして、TOEICの残り40分は火曜に回しました。夕食はそのままで、週6時間の目標とゼミレポート「地域経済の課題」の締切も守れます。");
  });
});
