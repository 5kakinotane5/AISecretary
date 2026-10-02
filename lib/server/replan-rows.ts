import {
  ScheduleItemSchema,
  type EngineReplanResult,
  type PlannedItem,
  type ReplanChange,
  type ScheduleItem,
  type Task,
} from "@/lib/schemas";
import type { PlanItemRow } from "@/lib/server/repositories/plans";

type EngineReplanOk = Extract<EngineReplanResult, { ok: true }>;

export type ReplanRows = {
  updatedDays: { date: string; items: PlanItemRow[] }[];
  // proposal_id はまだ付けない。after 側の id だけ updatedDays の行と同じ新しい id に置き換えたもの
  proposal: EngineReplanOk["proposal"];
};

// 再計画の提案で保存する行を組み立てる（plans-replan.md 12.2 の 8）。DB・時計には触れない。
// - updated_days の全項目に新しい id（newId で作る）。同じ元の id には同じ新しい id
// - proposal.after・changes[].after・other_day_changes[].after も同じ対応で置き換える。
//   before 側は元の id のまま（画面が before の id で「変更なし」を数える）
// - 行の中身は Engine の項目のまま（Engine が now で切った進行中のタスクを Before の値で戻さない。FR-12-4 の例外）
// - carried は保存されている行の値を引き継ぐ（なければ false）
export function buildReplanRows(input: {
  result: EngineReplanOk;
  storedRows: Map<string, PlanItemRow>;
  userId: string;
  weeklyPlanId: string;
  newId: () => string;
}): ReplanRows {
  const { result, storedRows, userId, weeklyPlanId } = input;
  const idMap = new Map<string, string>();
  const newId = (oldId: string) => {
    let id = idMap.get(oldId);
    if (!id) {
      id = input.newId();
      idMap.set(oldId, id);
    }
    return id;
  };

  const toRow = (item: PlannedItem, date: string): PlanItemRow => {
    const stored = storedRows.get(item.id);
    return {
      ...ScheduleItemSchema.parse(item),
      id: newId(item.id),
      user_id: userId,
      weekly_plan_id: weeklyPlanId,
      date,
      // Engine は Before（reason_code なし）から写した項目の reason_code を知らないので、理由が同じなら保存されている値を使う
      reason_code:
        item.reason_code ?? (stored && stored.reason === item.reason ? stored.reason_code : null),
      carried: stored?.carried ?? false,
    };
  };
  const updatedDays = result.updated_days.map((day) => ({
    date: day.date,
    items: day.items.map((item) => toRow(item, day.date)),
  }));

  const remap = (item: ScheduleItem): ScheduleItem => ({ ...item, id: newId(item.id) });
  const remapChange = (change: ReplanChange): ReplanChange => ({
    ...change,
    after: change.after.map(remap),
  });
  const proposal = {
    ...result.proposal,
    after: { date: result.proposal.after.date, items: result.proposal.after.items.map(remap) },
    changes: result.proposal.changes.map(remapChange),
    other_day_changes: result.proposal.other_day_changes.map(remapChange),
  };

  return { updatedDays, proposal };
}

// tasks の1行（apply_replan が jsonb_populate_recordset でそのまま insert する。列名と同じキーをすべて持つ）
export type NewTaskRow = Task & { user_id: string; created_at: string };

// 会話で足したタスク（replan-add.md 12.19 の new_tasks）の行。select * で insert するため、
// default のある user_id・created_at も入れる（入れないと null が入る。confirm_goal の tasks と同じ）
export function buildNewTaskRows(input: { tasks: readonly Task[]; userId: string; now: string }): NewTaskRow[] {
  return input.tasks.map((task) => ({
    id: task.id,
    user_id: input.userId,
    title: task.title,
    goal_id: task.goal_id,
    deadline_at: task.deadline_at,
    estimated_minutes: task.estimated_minutes,
    remaining_minutes: task.remaining_minutes,
    importance: task.importance,
    concentration: task.concentration,
    splittable: task.splittable,
    interruptible: task.interruptible,
    buffer_fit: task.buffer_fit,
    status: task.status,
    created_at: input.now,
  }));
}
