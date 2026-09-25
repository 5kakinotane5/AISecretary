import { z } from "zod";

// ---------- 列挙 ----------
export const LevelSchema = z.enum(["low", "medium", "high"]);
export const GoalPlanStyleSchema = z.enum(["intensive", "balanced", "paced"]);
export const PlanStyleSchema = z.enum(["intensive", "balanced", "relaxed"]);
export const ItemKindSchema = z.enum(["sleep", "fixed", "travel", "task", "buffer", "free"]);
export const FixedCategorySchema = z.enum(["class", "work", "meal", "social", "family", "other"]);
export const TravelModeSchema = z.enum(["walk", "train", "bus", "bike", "walk_train"]);
export const TaskStatusSchema = z.enum(["not_started", "in_progress", "completed"]);
export const InterviewStateSchema = z.enum([
  "INTERVIEWING", "CONFIRMING", "COMPLETED", "READY_FOR_PLANNING", "PLANNING", "PLAN_PROPOSED",
]);
export const InterviewStepSchema = z.enum([
  "category", "goal", "current_status", "conditions", "time_estimation",
  "goal_candidates", "user_selection", "summary", "final_confirmation",
]);

// ---------- 利用者・場所・移動 ----------
export const LocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  kind: z.enum(["home", "university", "work", "other"]),
});

export const TravelTimeSchema = z.object({
  from_location_id: z.string(),
  to_location_id: z.string(),
  minutes: z.number().int().positive(),
  mode: TravelModeSchema,
  note: z.string().nullable(),
});

export const UserPreferenceSchema = z.object({
  sleep_start: z.string(),               // "00:00"
  sleep_end: z.string(),                 // "07:30"
  daily_work_limit_minutes: z.number().int(),
  min_buffer_minutes: z.number().int(),  // 予定の間の最低バッファ
  min_daily_buffer_minutes: z.number().int(),
});

// ---------- 固定予定・タスク・目標 ----------
export const FixedEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: FixedCategorySchema,
  location_id: z.string().nullable(),
  start_at: z.string(),
  end_at: z.string(),
  recurrence: z.enum(["weekly"]).nullable(),
});

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal_id: z.string().nullable(),
  deadline_at: z.string().nullable(),
  estimated_minutes: z.number().int(),
  remaining_minutes: z.number().int(),
  importance: LevelSchema,
  concentration: LevelSchema,   // 集中力要求度
  splittable: z.boolean(),
  interruptible: z.boolean(),
  buffer_fit: LevelSchema,      // バッファ適性
  status: TaskStatusSchema,
});

export const GoalSchema = z.object({
  id: z.string(),
  task_name: z.string(),
  category: z.string(),
  target_hours_per_week: z.number().nullable(),
  frequency: z.string().nullable(),
  deadline: z.string().nullable(),       // YYYY-MM-DD
  priority: LevelSchema,
  conditions: z.array(z.string()),
  user_selected_plan: GoalPlanStyleSchema,
});

// ---------- ヒアリング ----------
export const InterviewMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["ai", "user"]),
  text: z.string(),
  created_at: z.string(),
});

export const GoalTimeCandidateSchema = z.object({
  style: GoalPlanStyleSchema,
  label: z.string(),                 // 短期集中型 など
  hours_per_week: z.number(),
  expected_load: LevelSchema,
  period_weeks: z.number().nullable(),
  characteristics: z.string(),
  merit: z.string(),
  caution: z.string(),
  reason: z.string(),
});

export const InterviewMessageRequestSchema = z
  .object({
    session_id: z.string(),
    text: z.string().optional(),
    selection: z
      .object({
        style: GoalPlanStyleSchema,
        hours_per_week: z.number().min(1).max(15).multipleOf(0.5),
      })
      .optional(),
  })
  .refine((v) => (v.text === undefined) !== (v.selection === undefined), {
    message: "text と selection はどちらか一方だけを指定する",
  });

export const InterviewTurnSchema = z.object({
  session_id: z.string(),
  state: InterviewStateSchema,
  step: InterviewStepSchema,
  step_index: z.number().int(),       // 1〜9
  messages: z.array(InterviewMessageSchema),   // このターンで増えた発言
  quick_replies: z.array(z.string()),
  goal_candidates: z.array(GoalTimeCandidateSchema).nullable(),
  goal_draft: GoalSchema.nullable(),  // 要約・最終確認の段階で入る
});

// ---------- スケジュール ----------
export const ScheduleItemSchema = z.object({
  id: z.string(),
  kind: ItemKindSchema,
  title: z.string(),
  start_at: z.string(),
  end_at: z.string(),
  location_id: z.string().nullable(),
  task_id: z.string().nullable(),
  fixed_event_id: z.string().nullable(),
  fixed_category: FixedCategorySchema.nullable(),
  travel: z
    .object({ from_location_id: z.string(), to_location_id: z.string(), mode: TravelModeSchema })
    .nullable(),
  suggested_task_id: z.string().nullable(),   // buffer のときの候補
  locked: z.boolean(),
  status: z.enum(["planned", "completed"]),
  reason: z.string().nullable(),               // この時間に入れた理由
});

export const DayPlanSchema = z.object({
  date: z.string(),
  items: z.array(ScheduleItemSchema),
});

export const PlanSummarySchema = z.object({
  task_hours: z.number(),
  buffer_hours: z.number(),
  free_hours: z.number(),
  travel_hours: z.number(),
  goal_hours: z.number(),              // 目標（TOEIC）に使う時間
  deadline_task_count: z.number().int(),
  overload: z.boolean(),
  explanation: z.string(),
});

export const ScheduleCandidateSchema = z.object({
  id: z.string(),
  style: PlanStyleSchema,
  label: z.string(),                   // 集中プラン など
  week_start: z.string(),              // 月曜の日付
  days: z.array(DayPlanSchema).length(7),
  summary: PlanSummarySchema,
});

// ---------- カレンダー ----------
export const DeadlineMarkSchema = z.object({ task_id: z.string(), title: z.string() });

export const DayViewSchema = z.object({
  date: z.string(),
  has_plan: z.boolean(),
  items: z.array(ScheduleItemSchema),  // 計画がない日は固定予定のみ
  deadlines: z.array(DeadlineMarkSchema),
});

export const MonthViewSchema = z.object({
  month: z.string(),                   // "2026-10"
  days: z.array(z.object({
    date: z.string(),
    has_plan: z.boolean(),
    kinds: z.array(z.enum(["class", "work", "task", "social"])),  // 小さな点に使う
    deadlines: z.array(DeadlineMarkSchema),
    task_hours: z.number(),
  })),
});

// ---------- 再計画 ----------
export const ReplanningIntentSchema = z.object({
  type: z.enum(["state_change", "task_change", "new_fixed_event", "preference_change"]),
  fatigue: LevelSchema.nullable(),
  task_changes: z.array(z.object({ task_id: z.string(), action: z.enum(["postpone", "skip", "shorten"]) })),
  new_fixed_events: z.array(FixedEventSchema),
  preference_changes: z.array(z.string()),
});

export const ReplanChangeSchema = z.object({
  change_type: z.enum(["moved", "shortened", "replaced", "removed", "added"]),
  before: ScheduleItemSchema.nullable(),
  after: z.array(ScheduleItemSchema),   // 置き換え後（複数になることがある）
  moved_to_date: z.string().nullable(), // 他の日へ移した場合
  reason: z.string(),
});

export const ReplanProposalSchema = z.object({
  proposal_id: z.string(),
  date: z.string(),
  intent: ReplanningIntentSchema,
  before: DayPlanSchema,
  after: DayPlanSchema,
  changes: z.array(ReplanChangeSchema),
  other_day_changes: z.array(ReplanChangeSchema),
  summary_message: z.string(),
});

// ---------- ダミーデータの検査 ----------
export const ValidationIssueCodeSchema = z.enum([
  "START_AFTER_END",
  "ITEM_OVERLAP",
  "FIXED_EVENT_OVERLAP",
  "SLEEP_OVERLAP",
  "TRAVEL_MISSING",
  "DEADLINE_VIOLATION",
  "BUFFER_SHORTAGE",
  "DAILY_LIMIT_EXCEEDED",
  "INVALID_REFERENCE",
  "FIXED_EVENT_MISMATCH",   // モック専用：固定予定の時刻・場所が案によって異なる
  "GOAL_HOURS_MISMATCH",    // モック専用：目標の週合計時間が案によって異なる
]);

export const ValidationIssueSchema = z.object({
  code: ValidationIssueCodeSchema,
  item_id: z.string().nullable(),
  message: z.string(),
  plan_id: z.string().nullable(),
  date: z.string().nullable(),
});

export const MockCheckResultSchema = z.object({
  errors: z.array(ValidationIssueSchema),
  warnings: z.array(ValidationIssueSchema),
});

// ---------- APIのリクエスト・レスポンス（mock-spec.md 4章・10.19） ----------
// app/api/ の Route Handler と lib/api.ts の両方がここから import する（サーバー側は lib/api.ts を import しない）

/** POST /api/auth/mock-login */
export const MockLoginRequestSchema = z.object({ email: z.string().nullable() });
export const MockLoginResponseSchema = z.object({ user_id: z.string(), display_name: z.string() });

/** POST /api/interview/confirm */
export const InterviewConfirmRequestSchema = z.object({ session_id: z.string() });
export const InterviewConfirmResponseSchema = z.object({
  state: z.literal("READY_FOR_PLANNING"),
  goal: GoalSchema,
});

/** POST /api/plans/generate（3案ちょうど） */
export const GeneratePlansRequestSchema = z.object({ session_id: z.string() });
export const GeneratePlansResponseSchema = z.object({ candidates: z.array(ScheduleCandidateSchema).length(3) });

/** GET /api/plans/candidates（generate と同じ形。まだ生成していなければ空配列） */
export const PlanCandidatesResponseSchema = z.object({ candidates: z.array(ScheduleCandidateSchema) });

/** POST /api/plans/{id}/select */
export const SelectPlanResponseSchema = z.object({ active_plan_id: z.string() });

/** GET /api/tasks */
export const TasksResponseSchema = z.object({ tasks: z.array(TaskSchema) });

// ---------- 型 ----------
export type PlanStyle = z.infer<typeof PlanStyleSchema>;
export type InterviewState = z.infer<typeof InterviewStateSchema>;
export type InterviewStep = z.infer<typeof InterviewStepSchema>;
export type InterviewMessage = z.infer<typeof InterviewMessageSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type TravelTime = z.infer<typeof TravelTimeSchema>;
export type TravelMode = z.infer<typeof TravelModeSchema>;
export type FixedEvent = z.infer<typeof FixedEventSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type GoalTimeCandidate = z.infer<typeof GoalTimeCandidateSchema>;
export type InterviewMessageRequest = z.infer<typeof InterviewMessageRequestSchema>;
export type InterviewTurn = z.infer<typeof InterviewTurnSchema>;
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;
export type DayPlan = z.infer<typeof DayPlanSchema>;
export type PlanSummary = z.infer<typeof PlanSummarySchema>;
export type ScheduleCandidate = z.infer<typeof ScheduleCandidateSchema>;
export type DayView = z.infer<typeof DayViewSchema>;
export type MonthView = z.infer<typeof MonthViewSchema>;
export type ReplanProposal = z.infer<typeof ReplanProposalSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type MockCheckResult = z.infer<typeof MockCheckResultSchema>;
export type GoalPlanStyle = z.infer<typeof GoalPlanStyleSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type MockLoginResponse = z.infer<typeof MockLoginResponseSchema>;
export type InterviewConfirmResponse = z.infer<typeof InterviewConfirmResponseSchema>;
