import { z } from "zod";
import {
  INTERVIEW_CATEGORIES,
  type GoalPlanStyle,
  type GoalTimeCandidate,
  type InterviewStep,
  type Level,
  type Task,
} from "@/lib/schemas";
import { diffMinutes } from "@/lib/datetime";
import { GOAL_PLAN_STYLE_LABELS } from "@/lib/labels";
import { computeGoalCandidateHours } from "@/lib/planning/goal-candidates";
import { FINAL_CONFIRMATION_MESSAGE, INTERVIEW_QUESTIONS } from "@/mocks/interview-script";
import { GOAL } from "@/mocks/goal";
import { GOAL_TIME_CANDIDATES } from "@/mocks/goal-candidates";
import { TASKS } from "@/mocks/tasks";
import type { InterviewSlots } from "./repositories/interview";

// LLM_MODE=off のヒアリング（backend.md 6.2.6）。モック（mock-spec 5.7・10.1・10.3）と同じ動きをする。
// 入力の内容に関係なく次のステップに進み、slots は G1（mocks/goal.ts）の値で埋める。

export type ScriptQuestion = {
  step: InterviewStep;
  step_index: number;
  ai_message: string;
  quick_replies: string[];
};

export type ScriptAnswer = {
  slots: Partial<InterviewSlots>; // このステップで抽出した（ことにする）項目
  next: ScriptQuestion;
  goal_candidates: GoalTimeCandidate[] | null; // ステップ4の回答のときだけ
};

function toQuestion(key: keyof typeof INTERVIEW_QUESTIONS): ScriptQuestion {
  const q = INTERVIEW_QUESTIONS[key];
  return { step: q.step, step_index: q.stepIndex, ai_message: q.aiMessage, quick_replies: q.quickReplies };
}

// ステップ1（category）の質問
export const FIRST_QUESTION = toQuestion("category");

// ステップ9（最終確認）の固定文（6.2.5）
export { FINAL_CONFIRMATION_MESSAGE };

// confirm で作る目標タスクのもと（6.2.6）。mocks/tasks.ts のうち G1 に紐づく2件（TOEIC リスニング演習・TOEIC 単語）。
// 8.2 のカテゴリ別テンプレートは使わない。id・goal_id・remaining_minutes は呼び出し側で決める
export const SCRIPT_GOAL_TASKS: Task[] = TASKS.filter((t) => t.goal_id === GOAL.id);

// ステップ1〜4 の回答の後に、G1 として埋める slots（6.2.2 の各ステップの抽出項目）
const G1_SLOTS: Record<1 | 2 | 3 | 4, Partial<InterviewSlots>> = {
  1: { category: z.enum(INTERVIEW_CATEGORIES).parse(GOAL.category) },
  // 目標・現状の文章は G1 にないので、台本の◎の回答（クイックリプライの先頭）を使う
  2: { goal_text: INTERVIEW_QUESTIONS.goal.quickReplies[0], task_name: GOAL.task_name },
  3: { current_status: INTERVIEW_QUESTIONS.current_status.quickReplies[0] },
  // G1 の条件「平日は夜が中心」に当たる時間帯（6.2.6）
  4: {
    deadline: GOAL.deadline,
    conditions: GOAL.conditions,
    explicit_hours_per_week: null,
    frequency_per_week: null,
    weekday_time_band: "evening",
    weekend_time_band: null,
  },
};

const EXPECTED_LOAD: Record<GoalPlanStyle, Level> = { intensive: "high", balanced: "medium", paced: "low" };

// 期限までの週数（7.2.1）。期限なしは null
function weeksUntil(deadline: string | null, today: string): number | null {
  if (deadline === null) return null;
  return Math.ceil(diffMinutes(today, deadline) / (60 * 24) / 7);
}

// 目標時間3案（7.2）。slots は ステップ4 までの回答を反映したもの、today は YYYY-MM-DD
function buildGoalCandidates(slots: InterviewSlots, today: string): GoalTimeCandidate[] {
  const hours = computeGoalCandidateHours({
    category: slots.category ?? "その他",
    deadline: slots.deadline,
    today,
    explicit_hours_per_week: slots.explicit_hours_per_week,
    frequency_per_week: slots.frequency_per_week,
    main_minutes: 60, // 8.2：資格・テスト勉強のメイン（台本ではカテゴリは常に G1）
    // TODO: lib/server/planning-context.ts（8.3）ができたら、PlanningContext を作って
    // computeWeeklyFreeMinutes()（lib/planning/slots.ts）で今週の空きの合計を渡す。今は上限をかけない値にしている
    weekly_free_minutes: Number.POSITIVE_INFINITY,
  });
  const periodWeeks = weeksUntil(slots.deadline, today);

  // TODO: 文章は 7.2.3 のテンプレート（lib/llm/goal-candidates.ts）で作る。今は mocks の文章をそのまま使う
  return GOAL_TIME_CANDIDATES.map((mock) => ({
    ...mock,
    label: GOAL_PLAN_STYLE_LABELS[mock.style],
    hours_per_week: hours[mock.style],
    expected_load: EXPECTED_LOAD[mock.style],
    period_weeks: periodWeeks,
  }));
}

// ステップ1〜4 の text への台本の応答。ステップ4の回答ではステップ5の発言と3案を返す（mock-spec 10.1）。
// slots は今までの slots（3案の計算に使う）
export function answerByScript(stepIndex: 1 | 2 | 3 | 4, slots: InterviewSlots, today: string): ScriptAnswer {
  const extracted = G1_SLOTS[stepIndex];
  if (stepIndex < 4) {
    const nextKey = (["goal", "current_status", "conditions"] as const)[stepIndex - 1];
    return { slots: extracted, next: toQuestion(nextKey), goal_candidates: null };
  }

  // ステップ5（time_estimation）の発言を返し、画面はステップ6（goal_candidates）で3案を出す
  const timeEstimation = toQuestion("time_estimation");
  return {
    slots: extracted,
    next: { ...timeEstimation, step: "goal_candidates", step_index: 6 },
    goal_candidates: buildGoalCandidates({ ...slots, ...extracted }, today),
  };
}
