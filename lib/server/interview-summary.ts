import { GoalSchema, type Goal, type GoalPlanStyle, type Task } from "@/lib/schemas";
import { addDays, formatMonthDay, toDateStr } from "@/lib/datetime";
import type { InterviewSlots } from "./repositories/interview";

// selection を受けたときの目標案と、ステップ8の要約（backend.md 6.2.5）。LLM_MODE にかかわらず同じ

// 要約の末尾に付ける締切タスク：今日から何日以内か・最大何件か（6.2.5）
const NEAR_DEADLINE_DAYS = 14;
const NEAR_DEADLINE_MAX = 2;

// 目標の名前。task_name が入らなかったときはカテゴリ名（「その他」なら「目標」）で仮置きする（6.2.2）
export function taskNameOf(slots: InterviewSlots): string {
  const category = slots.category ?? "その他";
  return slots.task_name ?? (category === "その他" ? "目標" : category);
}

// slots と selection から目標案を作る（FR-03-5：selection はそのまま反映する）。id はここで振る
export function buildGoalDraft(
  slots: InterviewSlots,
  selection: { style: GoalPlanStyle; hours_per_week: number },
): Goal {
  return GoalSchema.parse({
    id: crypto.randomUUID(),
    task_name: taskNameOf(slots),
    category: slots.category ?? "その他",
    target_hours_per_week: selection.hours_per_week,
    frequency: slots.frequency_per_week === null ? null : `週${slots.frequency_per_week}回`,
    deadline: slots.deadline,
    priority: "medium", // 質問しない。初期値（補正 C-4）
    conditions: slots.conditions,
    user_selected_plan: selection.style,
  });
}

// 登録済みの締切タスクのうち、今日から14日以内に締切があるもの（締切の早い順に最大2件）。
// 目標タスク・完了済みは含めない。today は YYYY-MM-DD
function nearDeadlineTasks(tasks: Task[], today: string): Task[] {
  const last = addDays(today, NEAR_DEADLINE_DAYS);
  return tasks
    .filter((t) => t.goal_id === null && t.status !== "completed" && t.deadline_at !== null)
    .filter((t) => {
      const date = toDateStr(t.deadline_at!);
      return date >= today && date <= last;
    })
    .sort((a, b) => a.deadline_at!.localeCompare(b.deadline_at!))
    .slice(0, NEAR_DEADLINE_MAX);
}

// task_name を仮置きしたときに要約の末尾に付ける一文（6.2.2）
export const PROVISIONAL_NOTE = "内容が違う場合は、設定の『新しい長期目標を相談する』からやり直せます。";

// ステップ8の要約（要件定義 6.2.4 の定型文。6.2.5）。
// options.provisional が true なら、末尾に仮置きの一文（6.2.2）を付ける
export function buildSummaryMessage(
  goal: Goal,
  tasks: Task[],
  today: string,
  options: { provisional?: boolean } = {},
): string {
  const hours = goal.target_hours_per_week;
  // [補足条件や期限]：期限（「12/13まで」の形）と conditions を「・」でつなぐ。何もなければ括弧ごと省く
  const notes = [...(goal.deadline ? [`${formatMonthDay(goal.deadline)}まで`] : []), ...goal.conditions];
  const detail = notes.length > 0 ? `（${notes.join("・")}）` : "";

  const lines = [
    "目標の整理が完了しました！👍",
    "",
    "📚 今週の目標データ",
    `・${goal.task_name}：週${hours}時間${detail}`,
    "",
    `⏱️ 今週の合計目標時間：${hours}時間`,
    "",
    "この条件を元に、あなたの生活リズムや固定予定に合わせた",
    "おすすめのスケジュールプランを3つ作成します！",
    "",
    "準備ができたら「スケジュール作成」を押してください。",
  ];

  const near = nearDeadlineTasks(tasks, today);
  if (near.length > 0) {
    const names = near.map((t) => `${t.title}（${formatMonthDay(t.deadline_at!)}締切）`).join("と");
    lines.push("", `登録済みの${names}も一緒に考慮します。`);
  }
  if (options.provisional) lines.push("", PROVISIONAL_NOTE);
  return lines.join("\n");
}
