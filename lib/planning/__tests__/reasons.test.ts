import { describe, expect, it } from "vitest";
import { ScheduleItemSchema, type DayPlan, type ReasonCode, type ReplanChange, type ReplanProposal } from "@/lib/schemas";
import { computeTaskPriorities } from "../priority";
import { addBufferSuggestions, applyGenerationReasons, buildExplanation, buildReplanSummary, formatReason, replanReason, timeBandLabel } from "../reasons";
import { createPlanningContext } from "./fixtures";

const item = (overrides: Record<string, unknown> = {}) => ScheduleItemSchema.parse({ id: "x", kind: "free", title: "自由時間", start_at: "2026-10-05T08:00:00+09:00", end_at: "2026-10-05T09:00:00+09:00", location_id: "loc_home", task_id: null, fixed_event_id: null, fixed_category: null, travel: null, suggested_task_id: null, locked: false, status: "planned", reason: null, ...overrides });

const reasonParams = { deadlineAt: "2026-10-09T23:59:00+09:00", startAt: "2026-10-05T09:59:00+09:00", goalHours: 6, goalName: "TOEIC学習", taskName: "レポート", originalTaskName: "リスニング", replacementTaskName: "単語", date: "2026-10-07", time: "20:00", minutes: 30 };
const reasonCases: Array<[ReasonCode, string]> = [
  ["DEADLINE_EARLY", "締切（10/9）より早めに終わらせるため、朝に進めます"],
  ["DEADLINE_NEAR", "締切（10/9）が近いため、ここで仕上げます"],
  ["DEADLINE_STEADY", "締切（10/9）に向けて、少しずつ進めます"],
  ["GOAL_ROUTINE", "週6時間のTOEIC学習のため、朝に入れました"],
  ["OPTIONAL_EXTRA", "時間に余裕があるため、レポートを進めます"],
  ["LIGHT_TASK", "短い時間で終わるレポートを片付けます"],
  ["LIGHT_IN_BUFFER", "短い時間でできるレポートを候補にしました"],
  ["REST", "まずは休憩をとって、疲れを回復します"],
  ["TIRED_LIGHT", "疲れているため、集中力が必要なリスニングを、短時間でできる単語に切り替えました"],
  ["TIRED_MOVED", "集中力が必要なレポートは今日は避けました。締切（10/9）には間に合います"],
  ["GOAL_CARRYOVER", "週6時間の目標を保つため、水曜に振り替えました"],
  ["BUFFER_MERGED", "作業がなくなったため、空き時間にまとめました"],
  ["FREE_EXTENDED", "ゆっくり休めるようにしました"],
  ["FIXED_EVENT_ADDED", "20:00からの予定を入れました"],
  ["USER_POSTPONED", "レポートを水曜に回しました"],
  ["USER_SKIPPED", "レポートは今週はお休みにしました"],
  ["USER_SHORTENED", "レポートを30分に短くしました"],
  ["NEXT_WEEK", "レポートは締切（10/9）に間に合うよう、来週に回します"],
];

describe("reasons", () => {
  it.each([["09:59", "朝"], ["10:00", "午前"], ["11:59", "午前"], ["12:00", "午後"], ["16:59", "午後"], ["17:00", "夕方"], ["18:59", "夕方"], ["19:00", "夜"]])("%sは%s", (time, label) => expect(timeBandLabel(`2026-10-05T${time}:00+09:00`)).toBe(label));

  it.each(reasonCases)("%sを設計テンプレートへ変換する", (code, expected) => expect(formatReason(code, reasonParams)).toBe(expected));

  it("3案の説明文テンプレートを保つ", () => {
    const context = createPlanningContext();
    context.tasks.find((task) => task.id === "task_report")!.title = "レポート";
    context.tasks.find((task) => task.id === "task_es_a")!.title = "ES";
    context.tasks.find((task) => task.id === "task_research")!.title = "企業研究";
    const days: DayPlan[] = [{ date: "2026-10-05", items: [
      item({ id: "report", kind: "task", task_id: "task_report" }),
      item({ id: "es", kind: "task", task_id: "task_es_a", start_at: "2026-10-05T10:00:00+09:00", end_at: "2026-10-05T11:00:00+09:00" }),
      item({ id: "company", kind: "task", task_id: "task_research", start_at: "2026-10-05T12:00:00+09:00", end_at: "2026-10-05T13:00:00+09:00" }),
    ] }];
    expect(buildExplanation(context, days, "intensive")).toBe("締切のあるESとレポートを早めに終わらせ、企業研究も進めるプランです。空き時間は少なめです。");
    expect(buildExplanation(context, days, "balanced")).toBe("締切に余裕を持って間に合わせつつ、毎日空き時間を残すプランです。");
    expect(buildExplanation(context, days, "relaxed")).toBe("締切に間に合う範囲でゆっくり進め、休む時間とバッファを多めにとるプランです。");
    expect(buildExplanation(context, [{ date: days[0].date, items: [days[0].items[2]] }], "intensive")).toBe("目標の時間をしっかり確保し、企業研究も進める、空き時間は少なめのプランです。");
  });

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

  it("15分未満を除外し、同じ日の同じ軽作業を重複候補にしない", () => {
    const context = createPlanningContext();
    context.tasks = context.tasks.filter((task) => task.id === "task_mail");
    const days: DayPlan[] = [{ date: "2026-10-05", items: [
      item({ id: "first", kind: "buffer", title: "バッファ", start_at: "2026-10-05T08:00:00+09:00", end_at: "2026-10-05T08:15:00+09:00" }),
      item({ id: "short", kind: "buffer", title: "バッファ", start_at: "2026-10-05T08:15:00+09:00", end_at: "2026-10-05T08:29:00+09:00" }),
      item({ id: "second", kind: "buffer", title: "バッファ", start_at: "2026-10-05T08:30:00+09:00", end_at: "2026-10-05T08:45:00+09:00" }),
    ] }];
    const result = applyGenerationReasons(context, addBufferSuggestions(context, days, computeTaskPriorities(context, "2026-10-05")), "balanced");
    expect(result[0].items.map((entry) => entry.suggested_task_id)).toEqual(["task_mail", null, null]);
    expect(result[0].items[0]).toMatchObject({ reason_code: "LIGHT_IN_BUFFER", reason: "短い時間でできるメール返信を候補にしました" });
  });

  it("state_changeの理由テンプレートを設計文言どおり返す", () => {
    const context = createPlanningContext();
    const listening = context.tasks.find((task) => task.id === "task_toeic_listening")!;
    const vocab = context.tasks.find((task) => task.id === "task_toeic_vocab")!;
    expect(replanReason("REST", { context })).toBe("まずは休憩をとって、疲れを回復します");
    expect(replanReason("TIRED_LIGHT", { context, task: listening, replacement: vocab })).toBe("疲れているため、集中力が必要なTOEIC リスニング演習を、短時間でできるTOEIC 単語に切り替えました");
    expect(replanReason("GOAL_CARRYOVER", { context, task: listening, date: "2026-10-06" })).toBe("週6時間の目標を保つため、火曜に振り替えました");
    expect(replanReason("BUFFER_MERGED", { context })).toBe("作業がなくなったため、空き時間にまとめました");
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
    expect(buildReplanSummary(context, intent, [], [], [dinner])).toBe("お疲れさまです。今夜は軽めにして、夕食はそのままで、週6時間の目標とゼミレポート「地域経済の課題」の締切も守れます。");
  });

  it("new_fixed_eventとtask_changeの要約をテンプレート化する", () => {
    const context = createPlanningContext();
    const fixed = { id: "fx_added", title: "面談", category: "other" as const, location_id: null, start_at: "2026-10-05T20:00:00+09:00", end_at: "2026-10-05T21:00:00+09:00", recurrence: null };
    const fixedIntent: ReplanProposal["intent"] = { type: "new_fixed_event", fatigue: null, task_changes: [], new_fixed_events: [fixed], preference_changes: [] };
    expect(buildReplanSummary(context, fixedIntent, [], [], [])).toBe("20:00からの予定を入れました。");

    const before = item({ kind: "task", title: "レポート", task_id: "task_report" });
    const after = item({ id: "short", kind: "task", title: "レポート", task_id: "task_report", end_at: "2026-10-05T08:30:00+09:00" });
    const taskIntent: ReplanProposal["intent"] = { type: "task_change", fatigue: null, task_changes: [{ task_id: "task_report", action: "shorten" }], new_fixed_events: [], preference_changes: [] };
    const change: ReplanChange = { change_type: "shortened", before, after: [after], moved_to_date: null, reason: "短縮" };
    expect(buildReplanSummary(context, taskIntent, [change], [], [])).toBe("レポートを30分に短くしました。締切（10/9）には間に合います。");
  });
});
