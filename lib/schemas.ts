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

/** GET /api/calendar/week（月曜から7日分） */
export const WeekViewSchema = z.object({
  week_start: z.string(),              // 月曜の日付
  days: z.array(DayViewSchema).length(7),
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
  "GOAL_HOURS_MISMATCH",    // 目標の週合計時間が確定値と異なる（docs/design/planning.md 10.11）
  "PAST_PLACEMENT",         // now より前に新しく置いた項目がある
  "LOCKED_ITEM_CHANGED",    // 再計画で、ロック済み・完了済みの項目が変わった
  "CANDIDATES_TOO_SIMILAR", // 3案の違いが足りない（warnings だけで使う）
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

/** GET /api/settings */
export const SettingsResponseSchema = z.object({
  preferences: UserPreferenceSchema,
  locations: z.array(LocationSchema),
  travel_times: z.array(TravelTimeSchema),
  goal: GoalSchema.nullable(), // 目標の確定前は null（docs/design/common.md 3.2）
});

/** GET /api/tasks */
export const TasksResponseSchema = z.object({ tasks: z.array(TaskSchema) });

/** POST /api/plans/replan（2.5章。モックで結果を返せるのは「疲れた」を含む文だけ） */
export const ReplanRequestSchema = z.object({ date: z.string(), text: z.string() });
export const ReplanUnsupportedSchema = z.object({ supported: z.literal(false), message: z.string() });
export const ReplanResponseSchema = z.union([ReplanProposalSchema, ReplanUnsupportedSchema]);

/** POST /api/plans/replan/accept（レスポンスは DayView） */
export const ReplanAcceptRequestSchema = z.object({ proposal_id: z.string() });

/** GET・POST /api/mock/clock（デモ時刻。10.20章） */
export const MockClockResponseSchema = z.object({ now: z.string() });

/** POST /api/mock/reset */
export const MockResetResponseSchema = z.object({ ok: z.literal(true) });

// ---------- 本番化で追加（docs/design/common.md 3章） ----------

/** GET /api/clock：画面が「今」を知る唯一の口 */
export const ClockResponseSchema = z.object({ now: z.string(), demo_mode: z.boolean() });

/** すべてのAPIのエラー応答 */
export const ApiErrorCodeSchema = z.enum([
  "INVALID_REQUEST", "UNAUTHORIZED", "NOT_FOUND", "INVALID_STATE", "PROPOSAL_EXPIRED",
  "INFEASIBLE", "LLM_ERROR", "INTERNAL",
]);
export const ApiErrorSchema = z.object({ error: z.object({ code: ApiErrorCodeSchema, message: z.string() }) });

/** POST /api/auth/logout・DELETE /api/tasks/{id} */
export const OkResponseSchema = z.object({ ok: z.literal(true) });

// ----- チェックイン・タスク登録（画面は作らない。API だけ。docs/design/backend.md 9章） -----
export const DailyCheckinSchema = z.object({
  date: z.string(),                          // YYYY-MM-DD
  mood: LevelSchema.nullable(),              // low=落ち込み気味 / medium / high=良い
  fatigue: LevelSchema.nullable(),
  concentration: LevelSchema.nullable(),     // 集中できそうか
  want_task_ids: z.array(z.string()),
  avoid_task_ids: z.array(z.string()),
  note: z.string().nullable(),               // 自由入力の原文
});
export const CheckinRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mood: LevelSchema.nullable().optional(),
  fatigue: LevelSchema.nullable().optional(),
  concentration: LevelSchema.nullable().optional(),
  text: z.string().max(500).optional(),
});
export const CheckinResponseSchema = z.object({ checkin: DailyCheckinSchema.nullable() });

export const TaskCreateRequestSchema = TaskSchema.omit({ id: true, status: true, goal_id: true });
export const TaskUpdateRequestSchema = TaskSchema.omit({ id: true, goal_id: true }).partial();
export const TaskResponseSchema = z.object({ task: TaskSchema });

// ----- Planning Engine の入出力（docs/design/planning.md） -----
/** 時間帯。morning 6:00〜12:00、daytime 12:00〜18:00、evening 18:00〜就寝の30分前 */
export const TimeBandSchema = z.enum(["morning", "daytime", "evening"]);
/** 目標タスクを置きたい時間帯（利用者が言った場合だけ。平日＝月〜金、週末＝土日） */
export const GoalTimeBandsSchema = z.object({ weekday: TimeBandSchema.nullable(), weekend: TimeBandSchema.nullable() });

export const PlanningContextSchema = z.object({
  now: z.string(),                           // 計画の基準時刻（5分単位に切り上げる前の値）
  week_start: z.string(),                    // now を含む週の月曜
  style: PlanStyleSchema.nullable(),         // 再計画のとき：有効な計画の案。生成のときは null
  preferences: UserPreferenceSchema,
  home_location_id: z.string(),
  locations: z.array(LocationSchema),
  travel_times: z.array(TravelTimeSchema),
  fixed_events: z.array(FixedEventSchema),   // 今週に展開済み。id は元の id のまま
  goals: z.array(GoalSchema),                // 有効な目標（MVP では0件か1件）
  goal_week_target_minutes: z.record(z.string(), z.number().int()), // goal_id → 今週の目標分 W
  goal_done_minutes: z.record(z.string(), z.number().int()),        // goal_id → 実施済みの分 D
  goal_time_bands: z.record(z.string(), GoalTimeBandsSchema),       // goal_id → 時間帯の希望
  tasks: z.array(TaskSchema),                // 未完了。remaining_minutes は実施済みを引いた値
  checkin: DailyCheckinSchema.nullable(),    // 今日の分
  locked_items: z.array(ScheduleItemSchema), // 変更してはいけない既存の項目
});

export const ReasonCodeSchema = z.enum([
  "DEADLINE_EARLY", "DEADLINE_NEAR", "DEADLINE_STEADY", "GOAL_ROUTINE", "OPTIONAL_EXTRA",
  "LIGHT_TASK", "LIGHT_IN_BUFFER", "REST", "TIRED_LIGHT", "TIRED_MOVED", "GOAL_CARRYOVER",
  "BUFFER_MERGED", "FREE_EXTENDED", "FIXED_EVENT_ADDED", "USER_POSTPONED", "USER_SKIPPED", "USER_SHORTENED",
  "NEXT_WEEK",
]);

/** Engine が出す項目。API で返すときは ScheduleItemSchema.parse() で reason_code が落ちる */
export const PlannedItemSchema = ScheduleItemSchema.extend({ reason_code: ReasonCodeSchema.nullable() });

/** 目的ベクトル F(S)（すべて 0〜1。docs/design/planning.md 6章） */
export const ObjectiveVectorSchema = z.object({
  achievement: z.number(),
  deadline_safety: z.number(),
  task_fit: z.number(),
  buffer: z.number(),
  free_time: z.number(),
  control: z.number(),
  recovery: z.number(),
});

/** Engine が出す1案（id は API が DB に保存して付ける） */
export const EnginePlanSchema = z.object({
  style: PlanStyleSchema,
  label: z.string(),
  week_start: z.string(),
  days: z.array(z.object({ date: z.string(), items: z.array(PlannedItemSchema) })).length(7),
  summary: PlanSummarySchema,
  features: ObjectiveVectorSchema,           // API では返さず、weekly_plans.features に保存する
});

export const InfeasibleSchema = z.object({
  feasible: z.literal(false),
  reason: z.string(),
  required_changes: z.array(z.string()),
});

export const ValidationResultSchema = z.object({
  valid: z.boolean(),                        // errors が0件なら true
  errors: z.array(ValidationIssueSchema),
  warnings: z.array(ValidationIssueSchema),
});

export const EngineGenerateResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), plans: z.array(EnginePlanSchema).length(3), warnings: z.array(ValidationIssueSchema) }),
  z.object({ ok: z.literal(false), infeasible: InfeasibleSchema }),
]);

/** Engine の再計画の結果。proposal は proposal_id 以外の ReplanProposal */
export const EngineReplanResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    proposal: ReplanProposalSchema.omit({ proposal_id: true }),
    // accept で置き換える日（今日を含む）
    updated_days: z.array(z.object({ date: z.string(), items: z.array(PlannedItemSchema) })),
  }),
  z.object({ ok: z.literal(false), infeasible: InfeasibleSchema }),
]);

// ----- LLM（docs/design/backend.md）-----
// *LlmSchema は LLM に渡す形（型だけ。制約を付けない）、*CheckedSchema は受け取った後の検証用
export const INTERVIEW_CATEGORIES = ["資格・テスト勉強", "筋トレ・運動", "大学の課題・レポート", "就活", "その他"] as const;

/** 6.2.3 ヒアリングの抽出＋次の発言 */
export const InterviewLlmSchema = z.object({
  extracted: z.object({
    category: z.enum(INTERVIEW_CATEGORIES).nullable(),
    task_name: z.string().nullable(),
    goal_text: z.string().nullable(),
    current_status: z.string().nullable(),
    deadline: z.string().nullable(),
    conditions: z.array(z.string()),
    explicit_hours_per_week: z.number().nullable(),
    frequency_per_week: z.number().nullable(),    // 「週3回」→ 3
    weekday_time_band: TimeBandSchema.nullable(), // 「平日は夜が中心」→ evening
    weekend_time_band: TimeBandSchema.nullable(),
  }),
  user_said_unknown: z.boolean(),
  next_message: z.string(),
  quick_replies: z.array(z.string()),
});
/** 検証に通らない項目は、その項目だけ null（conditions は通るものだけ残す）にして続行する */
export const InterviewExtractedCheckedSchema = z.object({
  category: z.enum(INTERVIEW_CATEGORIES).nullable(),
  task_name: z.string().min(1).max(15).nullable(),
  goal_text: z.string().max(200).nullable(),
  current_status: z.string().max(200).nullable(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  conditions: z.array(z.string().min(1).max(30)).max(5),
  explicit_hours_per_week: z.number().min(0.5).max(40).nullable(),
  frequency_per_week: z.number().int().min(1).max(14).nullable(),
  weekday_time_band: TimeBandSchema.nullable(),
  weekend_time_band: TimeBandSchema.nullable(),
});

/** 7.2.3 3案の文章（intensive / balanced / paced の順で3件） */
export const GoalCandidateTextsLlmSchema = z.object({
  candidates: z.array(z.object({ characteristics: z.string(), merit: z.string(), caution: z.string(), reason: z.string() })),
});

/** 8.2 目標タスクの名前 */
export const GoalTaskNamesLlmSchema = z.object({ main: z.string(), light: z.string().nullable() });

/** 12.3 再計画の意図（サーバーが ReplanningIntentSchema に変換する） */
export const ReplanIntentLlmSchema = z.object({
  type: z.enum(["state_change", "task_change", "new_fixed_event", "preference_change", "unknown"]),
  fatigue: LevelSchema.nullable(),
  task_changes: z.array(z.object({ task_id: z.string(), action: z.enum(["postpone", "skip", "shorten"]) })),
  // 時刻は "HH:MM"
  new_fixed_events: z.array(z.object({ title: z.string().nullable(), start_time: z.string(), end_time: z.string().nullable() })),
  preference_changes: z.array(z.string()),
});

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
export type WeekView = z.infer<typeof WeekViewSchema>;
export type MonthView = z.infer<typeof MonthViewSchema>;
export type ReplanProposal = z.infer<typeof ReplanProposalSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type MockCheckResult = z.infer<typeof MockCheckResultSchema>;
export type GoalPlanStyle = z.infer<typeof GoalPlanStyleSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type MockLoginResponse = z.infer<typeof MockLoginResponseSchema>;
export type InterviewConfirmResponse = z.infer<typeof InterviewConfirmResponseSchema>;
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;
export type ReplanChange = z.infer<typeof ReplanChangeSchema>;
export type ReplanResponse = z.infer<typeof ReplanResponseSchema>;
export type ClockResponse = z.infer<typeof ClockResponseSchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type DailyCheckin = z.infer<typeof DailyCheckinSchema>;
export type TimeBand = z.infer<typeof TimeBandSchema>;
export type GoalTimeBands = z.infer<typeof GoalTimeBandsSchema>;
export type PlanningContext = z.infer<typeof PlanningContextSchema>;
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type PlannedItem = z.infer<typeof PlannedItemSchema>;
export type ObjectiveVector = z.infer<typeof ObjectiveVectorSchema>;
export type EnginePlan = z.infer<typeof EnginePlanSchema>;
export type Infeasible = z.infer<typeof InfeasibleSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type EngineGenerateResult = z.infer<typeof EngineGenerateResultSchema>;
export type EngineReplanResult = z.infer<typeof EngineReplanResultSchema>;
