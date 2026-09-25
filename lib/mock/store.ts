import type { Goal, InterviewState, PlanStyle } from "@/lib/schemas";
import { GOAL } from "@/mocks/goal";

// ---------- 4.1章 モックの状態 ----------
// サーバーのメモリ上に1人分の状態を持つ（再起動で初期値に戻る）。
// interview_session_id・interview_state・interview_goal_draft は4.1章の表には無いが、
// ヒアリングAPI（/api/interview/*）の進行を1セッション分だけ覚えておくために追加した内部状態。
type MockState = {
  interview_step_index: number;
  interview_session_id: string | null;
  interview_state: InterviewState;
  /** ヒアリング中（未確定）の目標案。/api/interview/confirm で goal に反映される */
  interview_goal_draft: Goal | null;
  goal: Goal;
  active_plan_style: PlanStyle;
  /** POST /api/plans/generate が呼ばれたか。GET /api/plans/candidates の返す内容を決める（10.19章） */
  plans_generated: boolean;
  replan_accepted: boolean;
  demo_now: string;
};

function initialState(): MockState {
  return {
    interview_step_index: 0,
    interview_session_id: null,
    interview_state: "INTERVIEWING",
    interview_goal_draft: null,
    goal: GOAL,
    active_plan_style: "balanced",
    plans_generated: false,
    replan_accepted: false,
    demo_now: "2026-10-05T07:00:00+09:00",
  };
}

let state: MockState = initialState();

export function getState(): MockState {
  return state;
}

export function resetState(): void {
  state = initialState();
}

export function startInterviewSession(sessionId: string): void {
  state = {
    ...state,
    interview_session_id: sessionId,
    interview_step_index: 1,
    interview_state: "INTERVIEWING",
    interview_goal_draft: null,
  };
}

export function setInterviewStepIndex(stepIndex: number): void {
  state = { ...state, interview_step_index: stepIndex };
}

export function setInterviewState(interviewState: InterviewState): void {
  state = { ...state, interview_state: interviewState };
}

export function setInterviewGoalDraft(goal: Goal): void {
  state = { ...state, interview_goal_draft: goal };
}

export function confirmGoal(goal: Goal): void {
  state = { ...state, goal };
}

export function setActivePlanStyle(style: PlanStyle): void {
  state = { ...state, active_plan_style: style };
}

export function setPlansGenerated(generated: boolean): void {
  state = { ...state, plans_generated: generated };
}

export function setReplanAccepted(accepted: boolean): void {
  state = { ...state, replan_accepted: accepted };
}

export function setDemoNow(now: string): void {
  state = { ...state, demo_now: now };
}
