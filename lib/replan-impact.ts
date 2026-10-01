import { diffMinutes, toDateStr } from "./datetime";
import { sumFreeTimeMinutes, sumMinutesOfKind } from "./schedule";
import type { ReplanChange, ReplanProposal, ScheduleItem, Task } from "./schemas";

/** ほかの日1日分：その日に増えたタスクの時間と、タスクごとの内訳 */
export type OtherDayImpact = {
  date: string;
  minutes: number;
  tasks: Array<{ task_id: string | null; title: string; minutes: number }>;
};

/**
 * 締切の確かめ（他の日へ移した、締切のあるタスクについて）
 * - ok：すべて締切の日までに収まっている
 * - none_moved：締切のあるタスクは他の日へ動いていない
 * - late：締切の日より後へ移したタスクがある（titles に名前）
 */
export type DeadlineImpact = { status: "ok" } | { status: "none_moved" } | { status: "late"; titles: string[] };

export type ReplanImpact = {
  /** 今日の増減（after − before。分） */
  today: { taskMinutesDelta: number; freeMinutesDelta: number };
  /** 日付の昇順 */
  otherDays: OtherDayImpact[];
  deadline: DeadlineImpact;
};

function taskMinutes(items: readonly ScheduleItem[], taskId: string | null): number {
  return items
    .filter((item) => item.kind === "task" && (taskId === null || item.task_id === taskId))
    .reduce((sum, item) => sum + diffMinutes(item.start_at, item.end_at), 0);
}

type Move = { change: ReplanChange; date: string; taskId: string | null; title: string; rawMinutes: number };

/**
 * 他の日への移動を、二重に数えずに1件ずつにする。
 *
 * other_day_changes を正とする。Engine（lib/planning/replan.ts の moveFuture）は他の日へ置くたびに
 * other_day_changes に「before＝今日の元の項目、after＝移した先の日に置いた項目、moved_to_date＝その日」を必ず記録する。
 * 一方 changes の moved_to_date は、予定の追加・タスクの変更のときに今日の側から同じ移動をもう一度書いたもの（after は空）で、
 * 疲れたとき（state_change）には記録されず、短縮して残りを移したときにも付かない。
 * そのため changes の moved_to_date（今日以外）は、同じ before.id・同じ日の other_day_changes がないときだけ足す。
 */
function collectMoves(proposal: ReplanProposal): Move[] {
  const moveKey = (change: ReplanChange) => `${change.before?.id ?? change.after[0]?.id ?? ""}:${change.moved_to_date ?? ""}`;
  const toMove = (change: ReplanChange): Move | null => {
    const placed = change.after.find((item) => item.kind === "task") ?? null;
    const source = change.before ?? placed;
    const date = change.moved_to_date ?? (placed ? toDateStr(placed.start_at) : null);
    if (!source || !date) return null;
    const taskId = source.task_id;
    // 移した先の項目があればその長さ（延長のときは元の長さを含むので、下の computeOtherDays で今日の減り分に抑える）。
    // changes の側（after が空）なら今日の元の項目の長さ
    const rawMinutes = change.after.length > 0 ? taskMinutes(change.after, taskId) : diffMinutes(source.start_at, source.end_at);
    return { change, date, taskId, title: placed?.title ?? source.title, rawMinutes };
  };

  const seen = new Set(proposal.other_day_changes.map(moveKey));
  const fromToday = proposal.changes.filter(
    (change) => change.moved_to_date !== null && change.moved_to_date !== proposal.date && !seen.has(moveKey(change)),
  );
  return [...proposal.other_day_changes, ...fromToday]
    .filter((change) => change.moved_to_date !== proposal.date)
    .map(toMove)
    .filter((move): move is Move => move !== null);
}

/**
 * 日付ごとの増えた分。
 * 他の日へ移した時間は、今日から減った時間を超えない。目標タスクを移した先の既存の枠を延ばしたとき（extendGoal）は
 * after の項目が延長後の長さ（元の分を含む）になるため、移動の after の長さをそのまま足すと多く数えてしまう。
 * そこで、同じ目標（目標のないタスクは同じタスク）ごとに今日の減った分を求め、各移動はその残りを上限にして数える。
 * 疲れたときの軽作業版（同じ目標の別タスク）が今日に入る分も、目標ごとにまとめることで差し引かれる。
 */
function computeOtherDays(proposal: ReplanProposal, tasks: Task[], moves: Move[]): OtherDayImpact[] {
  const goalOf = (taskId: string | null) => tasks.find((task) => task.id === taskId)?.goal_id ?? null;
  const groupOf = (taskId: string | null) => {
    const goalId = goalOf(taskId);
    return goalId ? `goal:${goalId}` : `task:${taskId ?? ""}`;
  };
  const groupMinutes = (items: ScheduleItem[], group: string) =>
    items
      .filter((item) => item.kind === "task" && groupOf(item.task_id) === group)
      .reduce((sum, item) => sum + diffMinutes(item.start_at, item.end_at), 0);

  const remaining = new Map<string, number>();
  const byDate = new Map<string, OtherDayImpact>();
  for (const move of [...moves].sort((a, b) => a.date.localeCompare(b.date))) {
    const group = groupOf(move.taskId);
    if (!remaining.has(group)) {
      const reduced = groupMinutes(proposal.before.items, group) - groupMinutes(proposal.after.items, group);
      remaining.set(group, Math.max(0, reduced));
    }
    const left = remaining.get(group)!;
    const minutes = Math.min(move.rawMinutes, left);
    remaining.set(group, left - minutes);
    if (minutes <= 0) continue;

    const day = byDate.get(move.date) ?? { date: move.date, minutes: 0, tasks: [] };
    day.minutes += minutes;
    const entry = day.tasks.find((task) => task.task_id === move.taskId && task.title === move.title);
    if (entry) entry.minutes += minutes;
    else day.tasks.push({ task_id: move.taskId, title: move.title, minutes });
    byDate.set(move.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 他の日へ移した、締切のあるタスクが、移した先の日 ≤ 締切の日に収まっているか */
function checkDeadlines(tasks: Task[], moves: Move[]): DeadlineImpact {
  const late: string[] = [];
  let checked = 0;
  for (const move of moves) {
    const task = tasks.find((entry) => entry.id === move.taskId);
    if (!task?.deadline_at) continue;
    checked += 1;
    if (move.date > toDateStr(task.deadline_at) && !late.includes(task.title)) late.push(task.title);
  }
  if (late.length > 0) return { status: "late", titles: late };
  return checked > 0 ? { status: "ok" } : { status: "none_moved" };
}

/**
 * 再計画の提案の影響を数字にする（frontend.md 14.2「数字で見る変化」）。画面の表示用で、配置は変えない。
 * tasks は GET /api/tasks の一覧（タスクの目標・締切を見るため）。取れなかったときは空配列を渡し、締切の結果は使わない
 */
export function computeReplanImpact(proposal: ReplanProposal, tasks: Task[]): ReplanImpact {
  const moves = collectMoves(proposal);
  return {
    today: {
      taskMinutesDelta: sumMinutesOfKind(proposal.after.items, "task") - sumMinutesOfKind(proposal.before.items, "task"),
      freeMinutesDelta: sumFreeTimeMinutes(proposal.after.items) - sumFreeTimeMinutes(proposal.before.items),
    },
    otherDays: computeOtherDays(proposal, tasks, moves),
    deadline: checkDeadlines(tasks, moves),
  };
}
