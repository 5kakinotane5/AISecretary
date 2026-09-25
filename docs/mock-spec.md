# Personal AI Secretary モック仕様書

## 0. この文書について

Claude Code がモックを実装するための仕様書。要件は `docs/requirements.md`、分担は `docs/codex_人割_タスク細分化_完成版_v2.md` を参照する。本書に書かれていないことは推測で作らず、実装者に確認すること。

### 0.1 モックのゴール

**LLMもDBも使わず、固定のダミーデータだけで、Demo Path をスマートフォンの画面で最初から最後までタップして通せること。**

見た目の作り込みより、画面・遷移・データの形がそろっていることを優先する。Day 1 以降はこのモックの上に本番機能を積み上げる（モックAPIの中身を本物に差し替える）ので、**データの形とAPIのパスは本番と同じにする**。

### 0.2 完了条件

以下をすべて満たしたらモック完成とする。

- [ ] スマートフォン幅（390px）で、下の「デモの通し操作」を最後まで操作できる
- [ ] カレンダーの月・週・日を切り替えて、選んだプランの内容が見られる
- [ ] 設定画面で場所と移動時間表が見られる
- [ ] すべての画面にローディング・エラーの表示がある
- [ ] `GET /api/mock/check` でダミーデータの検査エラーが0件
- [ ] `npm run typecheck` と `npm run lint` が通る

**デモの通し操作**

```text
/login でログイン
→ /interview で質問に答える（クイックリプライで進められる）
→ 目標時間3案から「バランス標準型」を6時間のまま選び、確定（3案の選択に関係なく、生成されるスケジュール3案は5.9章の固定データになるため。10章参照）
→ 「スケジュール作成」
→ /plans で3案を比較し、「バランスプラン」を選ぶ
→ /today に今日（10/5 月）の予定が出る
→ 「予定の変更をAIに伝える」から「今日は疲れた」
→ /replan で変更前後を確認し「この計画にする」
→ /today に変更後の予定が出る
→ カレンダータブで月・週・日を確認
```

### 0.3 技術的な制約

- Next.js（App Router）＋ TypeScript。`src/` ディレクトリは使わない
- UIは Tailwind CSS ＋ shadcn/ui。**shadcn は Base UI 版**（Radix版の `asChild` ではなく `render` を使う）。部品は `npx shadcn@latest add <name>` で追加する
- アイコンは lucide-react
- データの形はすべて `lib/schemas.ts` の Zod スキーマで定義し、型は `z.infer` で作る。**スキーマ以外の場所で同じ形の型を手書きしない**
- 日付ライブラリは追加しない。表示は `Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo" })` を使う
- LLM（OpenAI）・Supabase・認証ライブラリは使わない
- 上記以外の npm パッケージは、追加する前に理由を報告する

---

## 1. 画面の共通仕様

### 1.1 レイアウト

- 基準幅は **390px**。375〜430pxで崩れないこと
- 画面幅が **640px以上** のときは、アプリを「スマホの枠」の中に表示する（`components/layout/MobileShell.tsx`。10.16参照）
  - 枠：幅390px・高さ844px、角丸40px程度、濃い色（`--brand-dark`）の縁取りと影、画面中央に配置
  - 枠の外は `docs/design-spec.md` 5.1の背景（`--brand-bg` に紫のぼかし）
  - 枠の中だけがスクロールし、タブバーや下部の固定要素は枠の下端に固定される
- **640px未満**（実際のスマホ）では枠を出さず、画面いっぱいに表示する
- 画面下部の固定要素（タブバー、入力欄、主ボタン）は `env(safe-area-inset-bottom)` の余白をとる
- タップできる要素は高さ44px以上
- 文字は本文16px（入力欄は16px未満にしない。iPhoneで勝手にズームされるため）

### 1.2 ナビゲーション

2つの状態で画面構成が変わる。

| 状態 | 画面 | 下部 |
|---|---|---|
| 初回設定（オンボーディング） | `/login` → `/interview` → `/plans` | タブバーなし。上部に戻るボタンと進行状況 |
| 通常利用 | `/today`、`/calendar`、`/replan`、`/settings` | タブバーあり |

**タブバー（4つ）**

| タブ | アイコン | 遷移先 |
|---|---|---|
| 今日 | `CalendarCheck` | `/today` |
| カレンダー | `CalendarDays` | `/calendar` |
| AIに相談 | `MessageCircle` | `/replan` |
| 設定 | `Settings` | `/settings` |

### 1.3 予定の種類ごとの見た目

タイムライン・カレンダーのすべてで共通にする。定義は `lib/labels.ts` に1か所で持つ。

| kind / category | 表示名 | 見た目 | アイコン |
|---|---|---|---|
| `fixed`（class / work / other） | 授業・バイトなど | `bg-slate-200` 濃い文字 | `School` / `Briefcase` |
| `fixed`（meal） | 食事 | `bg-slate-100` | `Utensils` |
| `fixed`（social / family） | 友人・家族との時間 | `bg-rose-100` | `Heart` |
| `travel` | 移動 | `bg-gray-100`・破線の枠・「移動 50分（電車）」 | `TrainFront` / `Footprints` |
| `task` | タスク | `bg-blue-50`・左に太い青線 | `CircleCheck` |
| `buffer` | バッファ | `bg-amber-50`・破線の枠・候補タスクがあれば「候補：メール返信」 | `Hourglass` |
| `free` | 自由時間 | `bg-emerald-50` | `Coffee` |
| `sleep` | 睡眠 | 1行に折りたたみ「睡眠 0:00–7:30」 | `Moon` |

- 締切のあるタスクにはバッジ「締切 10/9」を付ける（見た目は `docs/design-spec.md` 9.4参照。赤は使わない）
- `status: "completed"` の項目は薄く表示し、チェックマークを付ける
- `locked: true` の項目には小さな鍵アイコンを付ける

### 1.4 共通の状態表示

| 状態 | 表示 |
|---|---|
| ローディング | shadcn の Skeleton。スケジュール生成と再計画は「スケジュールを作成しています…」などの文言付き |
| エラー | エラー文と「再試行」ボタン |
| 空 | 「この日の計画はまだありません」など、状況に合った一文 |

**エラー表示の確認方法**：画面のURLに `?mock_error=1` を付けると、その画面のAPI呼び出しが500エラーを返す（`lib/api.ts` で実装）。

---

## 2. 画面ごとの仕様

### 2.1 `/login` ログイン（スプラッシュ）

- メールアドレス欄はない。画面はスプラッシュ（見た目・文言は `docs/design-spec.md` 6章参照）
- 下部に白い主ボタン（1つだけ）
- ボタンを押す → `POST /api/auth/mock-login`（`{ email: null }`）→ `/interview`（10.11参照）

### 2.2 `/interview` 目標相談

**上部**：タイトル「目標を相談」、進行状況バー（例：`3 / 9`）、戻るボタン

**本文**：チャット

- AIの吹き出しは左、ユーザーの吹き出しは右
- AIの発言の直後に、クイックリプライ（選択肢ボタン）を横並びで表示。タップするとその文言をユーザーの発言として送信する
- 自由入力もできる。モックでは入力内容に関係なく台本の次に進む（ユーザーの吹き出しには入力した文言をそのまま表示する）
- AIの返答待ちの間は「…」のアニメーションを表示

**下部**：入力欄と送信ボタン（固定）

**目標時間3案（ステップ6）**

- チャットの中に、3枚のカードを**縦に同じ大きさで**並べる。特定の案だけを目立たせない
- 各カード：表示名、週あたりの時間（大きく）、負荷のバッジ、想定期間、特徴、メリット、注意点、理由、「これにする」ボタン
- 「これにする」→ 選んだカードに「±0.5時間」の調整ボタン（1〜15時間の範囲）と「この内容で確定」ボタンが出る
- 「この内容で確定」→ `POST /api/interview/message`（`selection` 付き）→ AIが要約（ステップ8）と最終確認（ステップ9）を表示

**最終確認（ステップ9）**

- 要件定義書 6.2.4 の定型文をAIの吹き出しで表示
- 「確定する」ボタン → `POST /api/interview/confirm` → 状態が `READY_FOR_PLANNING` になる
- その後、画面下部に大きな「スケジュール作成」ボタンを表示する。**確定しただけでは自動で生成しない**
- 「スケジュール作成」→ `POST /api/plans/generate` → `/plans`

### 2.3 `/plans` プラン選択

**上部**：タイトル「今週のプランを選ぶ」、期間「10/5（月）〜10/11（日）」

**比較表**：3案を横に並べた小さな表。行はタスク・バッファ・自由時間・移動・TOEIC・締切タスク。どの案でも同じ行が同じ位置に来るようにする

**切り替え**：集中／バランス／ゆとり のセグメントボタン（初期表示はバランス）

**選択中の案の詳細**

- 説明文（explanation）
- 曜日チップ「月 火 水 木 金 土 日」で日を切り替え、その日のタイムラインを表示（初期表示は月曜）

**下部**：「このプランにする」ボタン（固定）→ `POST /api/plans/{id}/select` → `/today`

### 2.4 `/today` 今日

**上部**：日付「10月5日（月）」、デモ時刻（`demo_now`。例：「07:00 現在」）、今日の合計（タスク 3.5h ／ バッファ ／ 自由時間）

**本文**：今日のタイムライン

- 時刻ラベル＋ブロックの縦並び。ブロックの高さは所要時間に比例（1分＝1.2px、最小48px）
- 睡眠は1行に折りたたむ
- 現在時刻の位置に赤い横線
- タスクやバッファのブロックをタップすると、下からシート（shadcn の Sheet または Drawer）で詳細を表示：タイトル、時間、場所、締切、この時間に入れた理由（reason）

**下部**：タイムラインのカードの下・タブバーの上に、紫の主ボタン（「航路を調整する」）を固定表示 → `/replan`（見た目は `docs/design-spec.md` 5.3・6章参照。10.12参照）

「この計画にする」で再計画を確定すると `/today?updated=1` に遷移する。`/today` は `updated=1` があれば「計画を更新しました」のトーストを1回表示し、`router.replace` で `/today` にしてクエリパラメータを消す（10章参照）

### 2.5 `/replan` 予定変更

**上部**：タイトル「予定を変更」、デモ時刻（`demo_now`。例：「18:00 現在」）

画面を開いたら `POST /api/mock/clock` を呼び、`demo_now` が18:00より前なら18:00に進める。時刻表示の下に、その場合だけ小さく「デモのため、時刻を18:00に進めました」と表示する（すでに18:00以降なら何も表示しない）。10章参照

**入力前**

- AIの吹き出し「予定の変更や、今の状態を教えてください」
- クイックリプライ：「今日は疲れた」「18時から予定が入った」「このタスクを明日に回したい」「今から30分だけ何かやりたい」
- 自由入力欄

モックで結果を返せるのは「今日は疲れた」とその言い換え（「疲れた」を含む文）だけ。それ以外は、AIの吹き出しで「このデモでは『今日は疲れた』のみ対応しています」と返す。

**結果**

- AIの吹き出しで要約（summary_message）
- 変更点の一覧：変更された項目だけを「変更前（取り消し線）→ 変更後」で表示し、それぞれに理由を添える
- 「変更なし ◯件」は折りたたみ。開くと変更のない項目の一覧
- 「ほかの日への影響」：10/7（水）・10/8（木）に移した内容
- 「変更前と変更後を並べて見る」の切り替えで、2本のタイムラインを左右に表示（幅が狭いのでブロックは簡略表示）
- 下部に「この計画にする」と「やめておく」

「この計画にする」→ `POST /api/plans/replan/accept` → `/today`。「やめておく」→ `/today`（何も変えない）

### 2.6 `/calendar` カレンダー

**上部**：月／週／日 のセグメントボタン（初期表示は週）、期間の表示と「＜」「＞」

**月表示**

- 月曜始まりの7列グリッド。2026年10月は1日が木曜
- 各マス：日付、今日は丸で囲む、締切がある日は赤い点と件数、計画がある日は薄い青の背景、予定の種類ごとの小さな点（最大3つ）
- マスの下に「計画あり」の週を示す細い帯
- 日付をタップ → 日表示に切り替え
- 2026年10月以外は空の表示「この月のデータはありません」

**週表示**

- 7列の縦タイムグリッド（7:00〜24:00、1時間＝32px）。列見出しは「5 月」のように日付と曜日
- ブロックは色だけで表し、文字は入る場合のみ短く表示
- 列見出しをタップ → その日の日表示
- 計画のない週は固定予定だけを表示

**日表示**

- `/today` と同じタイムライン部品を使う
- 「＜」「＞」で前日・翌日へ

### 2.7 `/settings` 設定

- **生活リズム**：睡眠 0:00〜7:30、1日の作業上限 6時間、バッファの最低量 15分（表示のみ）
- **よく行く場所**：名前と住所の一覧（表示のみ）
- **移動時間**：「自宅 → 架空大学 つばさキャンパス　50分（徒歩＋電車）」の形式で一覧（表示のみ）
- **目標**：現在の目標「TOEIC 730点　週6時間」と「新しい目標を相談する」ボタン（→ `/interview`）
- **デモ用**：デモ時刻の切り替え（07:00 ／ 18:00）、「モックをリセット」ボタン

---

## 3. データの約束（`lib/schemas.ts`）

以下をそのまま実装する。フィールド名は snake_case。日時は `+09:00` 付きの ISO 8601、日付は `YYYY-MM-DD`。

```ts
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

// ---------- 型 ----------
export type Location = z.infer<typeof LocationSchema>;
export type TravelTime = z.infer<typeof TravelTimeSchema>;
export type FixedEvent = z.infer<typeof FixedEventSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type GoalTimeCandidate = z.infer<typeof GoalTimeCandidateSchema>;
export type InterviewMessageRequest = z.infer<typeof InterviewMessageRequestSchema>;
export type InterviewTurn = z.infer<typeof InterviewTurnSchema>;
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;
export type DayPlan = z.infer<typeof DayPlanSchema>;
export type ScheduleCandidate = z.infer<typeof ScheduleCandidateSchema>;
export type DayView = z.infer<typeof DayViewSchema>;
export type MonthView = z.infer<typeof MonthViewSchema>;
export type ReplanProposal = z.infer<typeof ReplanProposalSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type MockCheckResult = z.infer<typeof MockCheckResultSchema>;
```

> 3章のスキーマ定義は、10章で決定した `InterviewMessageRequestSchema`・`ValidationIssueSchema`・`MockCheckResultSchema` を反映済み（10.2・10.8参照）。

---

## 4. モックAPI

`app/api/` の Route Handlers で実装する。**パスとレスポンスの形は本番と同じ**にし、中身だけ `mocks/` のデータを返す。レスポンスは返す前に必ずスキーマの `.parse()` を通す。

| メソッド・パス | リクエスト | レスポンス | 待ち時間 |
|---|---|---|---|
| `POST /api/auth/mock-login` | `{ email: string \| null }`（`/login`のボタンからは常に`null`） | `{ user_id, display_name }` | 400ms |
| `POST /api/interview/start` | なし | `InterviewTurn`（ステップ1） | 400ms |
| `POST /api/interview/message` | `InterviewMessageRequestSchema`（`text`・`selection`のどちらか一方だけ。両方/どちらもなしは400） | `InterviewTurn`（次のステップ。ユーザー入力を要しないステップは1回の応答にまとめる。10.1参照） | 800ms |
| `POST /api/interview/confirm` | `{ session_id }` | `{ state: "READY_FOR_PLANNING", goal: Goal }` | 400ms |
| `POST /api/plans/generate` | `{ session_id }` | `{ candidates: ScheduleCandidate[] }`（3件） | 1500ms |
| `GET /api/plans/candidates` | — | `{ candidates: ScheduleCandidate[] }`（generate と同じ形。`plans_generated` が `false` なら空配列。10.19参照） | 400ms |
| `POST /api/plans/{id}/select` | なし | `{ active_plan_id }` | 400ms |
| `GET /api/calendar/day?date=` | — | `DayView` | 400ms |
| `GET /api/calendar/week?start=` | — | `{ week_start, days: DayView[] }` | 400ms |
| `GET /api/calendar/month?month=` | — | `MonthView` | 400ms |
| `POST /api/plans/replan` | `{ date, text }` | `ReplanProposal` または `{ supported: false, message }` | 1200ms |
| `POST /api/plans/replan/accept` | `{ proposal_id }` | `DayView` | 400ms |
| `GET /api/settings` | — | `{ preferences, locations, travel_times, goal }` | 400ms |
| `GET /api/tasks` | — | `{ tasks: Task[] }`（既存の `TaskSchema`。10.17参照） | 400ms |
| `POST /api/mock/clock` | `{ now }` | `{ now }` | 0 |
| `POST /api/mock/reset` | なし | `{ ok: true }` | 0 |
| `GET /api/mock/check` | — | `MockCheckResultSchema`（`{ errors, warnings }`。6章の検査結果） | 0 |

- `?mock_error=1` の付いた画面からの呼び出しは、`lib/api.ts` がリクエストヘッダー `x-mock-error: 1` を付け、Route Handler は500を返す
- 画面（`app/` の page や `components/`）は `mocks/` を直接 import せず、必ず `lib/api.ts` 経由でAPIからデータを受け取る。`mocks/` を import してよいのは `app/api/` と `lib/mock/` だけ（10.17参照）
- `interview/message` の `selection` が送られたら、ステップ7→8へ進み、`goal_draft` の `target_hours_per_week` と `user_selected_plan` に反映する

### 4.1 モックの状態（`lib/mock/store.ts`）

サーバーのメモリ上に1人分の状態を持つ（再起動で初期値に戻る）。

| 項目 | 初期値 | 説明 |
|---|---|---|
| `interview_step_index` | 0 | ヒアリングの進み具合 |
| `goal` | 下の G1 | 確定した目標 |
| `active_plan_style` | `"balanced"` | 選択中のプラン |
| `plans_generated` | `false` | スケジュール3案を生成したか。`POST /api/plans/generate` で `true` になり、`GET /api/plans/candidates` はこれが `true` のときだけ3案を返す（10.19参照） |
| `replan_accepted` | `false` | 再計画を確定したか |
| `demo_now` | `2026-10-05T07:00:00+09:00` | デモ時刻 |

初期値でプランが選択済みになっているのは、開発中に `/today` や `/calendar` を直接開いても表示できるようにするため。

- `/replan` 画面を開いたら、画面から `POST /api/mock/clock` を呼び、`demo_now` が18:00より前なら18:00に進める（モック専用の動き。10.6参照）。`POST /api/plans/replan` が呼ばれたときも念のため同じ処理をする（二重に呼ばれても副作用はない）
- `replan_accepted` が `true` のとき、`calendar/day`・`week`・`month` は10/5をAfterの内容で、10/7・10/8を振り替え後の内容で返す
- `mock/reset` で全項目を初期値に戻す

---

## 5. デモ用データ（ペルソナとシナリオ）

**すべて架空のデータ**。住所・学校名・店名は実在しない。

### 5.1 ペルソナ

| 項目 | 内容 |
|---|---|
| 名前 | 佐藤 ひかり |
| 所属 | 架空大学 経済学部 3年 |
| 状況 | 就活準備を始めた。TOEICのスコアを上げたい |
| 生活リズム | 睡眠 0:00〜7:30、朝食 7:30〜8:00 |
| 1日の作業上限 | 6時間（360分） |
| バッファ | 予定の間は最低15分、1日合計60分以上 |

### 5.2 場所

| id | 名前 | 住所（架空） | kind |
|---|---|---|---|
| `loc_home` | 自宅 | 東京都ひばり市みどり町2-4-1 ひばりハイツ203 | home |
| `loc_univ` | 架空大学 つばさキャンパス | 東京都つばさ市おおぞら1-1 | university |
| `loc_cafe` | カフェ・ソレイユ ひばり駅前店（バイト先） | 東京都ひばり市さくら通り3-8 | work |
| `loc_station` | ひばり駅前（飲食店） | 東京都ひばり市さくら通り周辺 | other |

大学の図書館はキャンパス内なので `loc_univ` として扱う。

### 5.3 移動時間表

双方向で同じ時間とする（両方向の行をデータに入れる）。

| 区間 | 分 | 手段 | 備考 |
|---|---|---|---|
| 自宅 ⇄ 大学 | 50 | walk_train | 徒歩10分＋電車35分＋徒歩5分 |
| 大学 ⇄ カフェ | 35 | walk_train | |
| 大学 ⇄ ひばり駅前 | 35 | walk_train | |
| 自宅 ⇄ カフェ | 12 | walk | |
| 自宅 ⇄ ひばり駅前 | 12 | walk | |
| カフェ ⇄ ひばり駅前 | 3 | walk | |

### 5.4 目標

**G1**（ヒアリングで確定する内容）

| 項目 | 値 |
|---|---|
| id | `goal_toeic` |
| task_name | TOEIC学習 |
| category | 資格・テスト勉強 |
| target_hours_per_week | 6 |
| frequency | null |
| deadline | 2026-12-13（受験予定日） |
| priority | medium |
| conditions | ["平日は夜が中心", "現在600点、目標730点", "リスニングが苦手"] |
| user_selected_plan | balanced |

### 5.5 登録済みタスク

| id | タイトル | 締切 | 残り | 重要度 | 集中力 | 分割 | 中断 | バッファ適性 |
|---|---|---|---|---|---|---|---|---|
| `task_report` | ゼミレポート「地域経済の課題」 | 10/9 23:59 | 180分 | high | high | ○ | × | low |
| `task_es_a` | ES作成（企業A） | 10/12 23:59 | 120分 | high | high | ○ | × | low |
| `task_toeic_listening` | TOEIC リスニング演習 | なし（G1に紐づく） | — | medium | medium | ○ | ○ | low |
| `task_toeic_vocab` | TOEIC 単語 | なし（G1に紐づく） | — | medium | low | ○ | ○ | high |
| `task_research` | 企業研究 | なし | 180分 | medium | medium | ○ | ○ | medium |
| `task_mail` | メール返信 | なし | 15分 | low | low | × | ○ | high |
| `task_notes` | 授業資料の整理 | なし | 30分 | low | low | ○ | ○ | high |
| `task_stats_hw` | 統計学の課題 | 10/20 23:59 | 90分 | medium | high | ○ | × | low |
| `task_es_b` | ES作成（企業B） | 10/26 23:59 | 120分 | high | high | ○ | × | low |

`task_stats_hw` と `task_es_b` は今週の計画には入れない（月表示の締切に出すためのデータ）。

`task_toeic_listening`・`task_toeic_vocab` の「残り」欄の `—` は、10.13章の読み替えにより次の値にする。

- `task_toeic_listening`：`estimated_minutes` 60、`remaining_minutes` 360
- `task_toeic_vocab`：`estimated_minutes` 30、`remaining_minutes` 360

### 5.6 固定予定（毎週）と生活の骨組み

`FixedEventSchema` への入れ方は10.14章の決定事項のとおり。要点：

- 授業・ゼミ・バイト、朝食・昼食・夕食は `recurrence: "weekly"`。食事は曜日ごとに時刻が違うため、曜日ごとに別の固定予定として登録する
- 友人と夕食（金10/9）・家族と昼食（日10/11）はその週だけの約束のため `recurrence: null`
- 睡眠・移動は固定予定にしない（睡眠は `UserPreference`、移動はステップ3で作る計画の項目 `kind: travel` から）
- `recurrence: "weekly"` の予定も `start_at`・`end_at` には今週（10/5〜10/11）の日時を入れ、それを基準に毎週繰り返す。10月の他の週への展開はステップ4のカレンダーAPIで行う

今週（10/5〜10/11）の各日の骨組み。**移動は計画の項目（kind: travel）としてデータに入れる**。「空き」はタスク・バッファ・自由時間を置ける時間帯。10月の他の週も、授業・バイトは毎週同じ曜日・時刻に繰り返す（計画のない週は移動を表示しない）。

**月曜 10/5**

| 時間 | 内容 | 場所 |
|---|---|---|
| 0:00–7:30 | 睡眠 | 自宅 |
| 7:30–8:00 | 朝食 | 自宅 |
| 8:05–8:55 | 移動 自宅→大学 | |
| 9:00–10:30 | 1限 マクロ経済学 | 大学 |
| 10:40–12:10 | 2限 統計学 | 大学 |
| 12:10–13:00 | 昼食 | 大学 |
| 13:00〜 | 空き（大学）→ 帰宅の移動 50分 → 空き（自宅） | |
| 19:00–19:45 | 夕食 | 自宅 |
| 19:45–24:00 | 空き | 自宅 |

**火曜 10/6**

| 時間 | 内容 | 場所 |
|---|---|---|
| 7:30–8:00 | 朝食 | 自宅 |
| 8:00–11:30 | 空き | 自宅 |
| 11:30–12:00 | 昼食 | 自宅 |
| 12:05–12:55 | 移動 自宅→大学 | |
| 13:00–14:30 | 3限 英語コミュニケーション | 大学 |
| 14:40–16:10 | 4限 経営学 | 大学 |
| 16:15–16:50 | 移動 大学→カフェ | |
| 16:50–18:00 | 空き（カフェ周辺） | |
| 18:00–22:00 | バイト（休憩・まかない含む） | カフェ |
| 22:00–22:12 | 移動 カフェ→自宅 | |
| 22:15–22:45 | 夕食 | 自宅 |
| 22:45–24:00 | 空き | 自宅 |

**水曜 10/7**

| 時間 | 内容 | 場所 |
|---|---|---|
| 7:30–8:00 | 朝食 | 自宅 |
| 8:00–9:45 | 空き | 自宅 |
| 9:45–10:35 | 移動 自宅→大学 | |
| 10:40–12:10 | 2限 ミクロ経済学 | 大学 |
| 12:10–13:00 | 昼食 | 大学 |
| 13:00–14:30 | 空き | 大学 |
| 14:40–16:10 | ゼミ | 大学 |
| 16:15–17:05 | 移動 大学→自宅 | |
| 17:05–19:00 | 空き | 自宅 |
| 19:00–19:45 | 夕食 | 自宅 |
| 19:45–24:00 | 空き | 自宅 |

**木曜 10/8**

| 時間 | 内容 | 場所 |
|---|---|---|
| 7:30–8:00 | 朝食 | 自宅 |
| 8:05–8:55 | 移動 自宅→大学 | |
| 9:00–10:30 | 1限 計量経済学 | 大学 |
| 10:35–11:25 | 移動 大学→自宅 | |
| 11:25–12:00 | 空き | 自宅 |
| 12:00–12:45 | 昼食 | 自宅 |
| 12:45–19:00 | 空き | 自宅 |
| 19:00–19:45 | 夕食 | 自宅 |
| 19:45–24:00 | 空き | 自宅 |

**金曜 10/9**

| 時間 | 内容 | 場所 |
|---|---|---|
| 7:30–8:00 | 朝食 | 自宅 |
| 8:00–9:45 | 空き | 自宅 |
| 9:45–10:35 | 移動 自宅→大学 | |
| 10:40–12:10 | 2限 統計学演習 | 大学 |
| 12:10–13:00 | 昼食 | 大学 |
| 13:00–14:30 | 3限 金融論 | 大学 |
| 14:35–15:25 | 移動 大学→自宅 | |
| 15:25–18:45 | 空き | 自宅 |
| 18:45–18:57 | 移動 自宅→ひばり駅前 | |
| 19:00–21:00 | 友人と夕食（social） | ひばり駅前 |
| 21:00–21:12 | 移動 ひばり駅前→自宅 | |
| 21:15–24:00 | 空き | 自宅 |

**土曜 10/10**

| 時間 | 内容 | 場所 |
|---|---|---|
| 7:30–8:00 | 朝食 | 自宅 |
| 8:00–9:45 | 空き | 自宅 |
| 9:45–9:57 | 移動 自宅→カフェ | |
| 10:00–15:00 | バイト（休憩・まかない含む） | カフェ |
| 15:00–15:12 | 移動 カフェ→自宅 | |
| 15:15–19:00 | 空き | 自宅 |
| 19:00–19:45 | 夕食 | 自宅 |
| 19:45–24:00 | 空き | 自宅 |

**日曜 10/11**

| 時間 | 内容 | 場所 |
|---|---|---|
| 7:30–8:00 | 朝食 | 自宅 |
| 8:00–12:00 | 空き | 自宅 |
| 12:00–13:30 | 家族と昼食（family） | 自宅 |
| 13:30–19:00 | 空き | 自宅 |
| 19:00–19:45 | 夕食 | 自宅 |
| 19:45–24:00 | 空き | 自宅 |

### 5.7 ヒアリングの台本

| # | step | AIの発言 | クイックリプライ（◎が台本の回答） |
|---|---|---|---|
| 1 | category | こんにちは！予定づくりをお手伝いします。まずは、今いちばん力を入れたいことを教えてください。 | ◎資格・テスト勉強／筋トレ・運動／大学の課題・レポート／就活／その他 |
| 2 | goal | いいですね！具体的にはどんな目標ですか？ | ◎TOEICで730点を取りたい／まだ決めていない |
| 3 | current_status | 今のスコアや、得意・苦手なところはありますか？ | ◎前回は600点。リスニングが苦手／初めて受ける |
| 4 | conditions | 受験日や、勉強しやすい時間帯はありますか？分からなければ「未定」で大丈夫です。 | ◎12月13日に受験予定。平日は夜が中心／未定 |
| 5 | time_estimation | ありがとうございます。試験まで約10週間です。登録済みの授業・バイトの予定もふまえて、目標時間の案を3つ作りました。どれも正解・不正解はないので、しっくりくるものを選んでください。 | なし（続けて3案のカードを表示） |
| 6 | goal_candidates | （3案のカード） | |
| 7 | user_selection | （カードで「バランス標準型」を選び、6時間のまま確定） | |
| 8 | summary | 目標の整理が完了しました！👍（要件定義書 6.2.4 の定型文。タスク名1＝TOEIC学習：週6時間（12/13受験・現在600点→目標730点）、合計6時間。末尾に「登録済みのゼミレポート（10/9締切）とES（10/12締切）も一緒に考慮します。」を追加） | |
| 9 | final_confirmation | この内容で確定してよいですか？あとから変更もできます。 | 「確定する」ボタン |

### 5.8 目標時間3案

基準値は週6時間。

| style | label | 週 | 負荷 | 想定期間 | 特徴 | メリット | 注意点 | 理由 |
|---|---|---|---|---|---|---|---|---|
| intensive | 短期集中型 | 9時間 | high | 10週 | 毎日まとまった時間を確保 | 目標点に余裕を持って届きやすい | バイトのある火・土は負担が大きくなりやすい | 130点アップを確実にしたい場合の目安です |
| balanced | バランス標準型 | 6時間 | medium | 10週 | 平日夜を中心に週5日ほど | 授業・就活と両立しやすい | 苦手なリスニングは早めに重点化が必要 | 10週間で130点アップを目指す標準的な目安です |
| paced | マイペース型 | 3時間 | low | 10週 | 空き時間に少しずつ | 負担が小さく続けやすい | 目標点には追加の学習が必要になる可能性があります | 忙しい時期でも途切れずに続けたい場合の目安です |

### 5.9 スケジュール3案

3案とも **TOEIC は週360分**（G1を減らさない）。違いは、締切タスクの前倒し、企業研究の量、バッファ・自由時間の量で出す。

| | 集中プラン | バランスプラン | ゆとりプラン |
|---|---|---|---|
| id | `plan_intensive` | `plan_balanced` | `plan_relaxed` |
| レポート完了 | 火曜 | 水曜 | 木曜 |
| ES（企業A）完了 | 水曜 | 木曜 | 日曜 |
| 企業研究 | 180分 | 60分 | 0分 |
| バッファ | 予定間15分 | 予定間15分＋α | 予定間30分が中心 |
| explanation | 締切のあるレポートとESを早めに終わらせ、企業研究も進めるプランです。空き時間は少なめです。 | 締切に余裕を持って間に合わせつつ、毎日自由時間を残すプランです。 | 締切に間に合う範囲でゆっくり進め、休む時間とバッファを多めにとるプランです。 |

#### 月曜 10/5 の詳細（3案とも、朝〜昼食までは5.6と同じ）

**バランスプラン**（デモで選ぶ案。再計画の Before になる）

| 時間 | kind | 内容 | reason |
|---|---|---|---|
| 13:00–14:30 | task | ゼミレポート執筆（`task_report`）＠大学 | 締切（10/9）が近く、集中しやすい午後の図書館で進めます |
| 14:30–14:45 | buffer | バッファ（候補：`task_notes`） | |
| 14:45–15:35 | travel | 移動 大学→自宅 | |
| 15:35–17:45 | free | 自由時間 | |
| 17:45–18:00 | buffer | バッファ | |
| 18:00–19:00 | task | TOEIC リスニング演習（`task_toeic_listening`） | 苦手なリスニングを、平日夜の学習時間に入れました |
| 19:00–19:45 | fixed | 夕食 | |
| 19:45–20:45 | task | ES下書き（`task_es_a`） | 締切（10/12）に向けて、今日から少しずつ進めます |
| 20:45–21:00 | buffer | バッファ（候補：`task_mail`） | |
| 21:00–24:00 | free | 自由時間 | |

**集中プラン**

| 時間 | kind | 内容 |
|---|---|---|
| 13:00–15:00 | task | ゼミレポート執筆 ＠大学 |
| 15:00–15:15 | buffer | バッファ |
| 15:15–16:05 | travel | 移動 大学→自宅 |
| 16:05–16:45 | free | 自由時間 |
| 16:45–17:00 | buffer | バッファ（候補：メール返信） |
| 17:00–18:30 | task | TOEIC リスニング演習 |
| 18:30–19:00 | free | 自由時間 |
| 19:00–19:45 | fixed | 夕食 |
| 19:45–21:15 | task | ES下書き |
| 21:15–21:30 | buffer | バッファ |
| 21:30–22:00 | task | 企業研究 |
| 22:00–24:00 | free | 自由時間 |

**ゆとりプラン**

| 時間 | kind | 内容 |
|---|---|---|
| 13:00–14:00 | task | ゼミレポート執筆 ＠大学 |
| 14:00–14:30 | buffer | バッファ（候補：授業資料の整理） |
| 14:30–15:20 | travel | 移動 大学→自宅 |
| 15:20–18:30 | free | 自由時間 |
| 18:30–19:00 | task | TOEIC 単語 |
| 19:00–19:45 | fixed | 夕食 |
| 19:45–20:15 | buffer | バッファ（候補：メール返信） |
| 20:15–24:00 | free | 自由時間 |

#### 火曜〜日曜の割り当て（分）

各日のタスクを5.6の「空き」に置く。置き方のルールは6章に従う。高集中のタスク（レポート・ES・リスニング）は、単語やメールのような軽作業より前の、まとまった空きに置く。

| 日 | 集中プラン | バランスプラン | ゆとりプラン |
|---|---|---|---|
| 火 10/6 | レポート60（完了）、リスニング60（午前）、単語30（カフェ周辺） | 単語30（カフェ周辺）、企業研究は入れない | 単語30（カフェ周辺） |
| 水 10/7 | ES30（完了）、リスニング60、企業研究120 | レポート90（完了・大学13:00〜）、リスニング60 | レポート60、リスニング60 |
| 木 10/8 | リスニング90、企業研究30、授業資料の整理30 | ES60（完了）、リスニング90 | レポート60（完了）、リスニング90 |
| 金 10/9 | メール返信15（バッファ内）。夜は友人との時間を優先 | メール返信15（バッファ内） | タスクなし |
| 土 10/10 | 単語30（夕方） | リスニング60（夕方） | ES60、リスニング60 |
| 日 10/11 | タスクなし（休息日） | リスニング60、企業研究60 | ES60（完了）、リスニング90 |

TOEICの合計が3案とも360分になっていること（リスニング＋単語）を検査で確認する。`summary` の数値は手で書かず、`lib/mock/summarize.ts` で items から計算する。

#### 火〜日の詳細

10章（10.4・10.5）の手順で、上の割り当て表の分数を変えずに5.6章の「空き」へ配置した結果。時間は5分単位。`場所`は`location_id`（自宅=`loc_home`、大学=`loc_univ`、カフェ=`loc_cafe`）。`travel`は5.6章の固定の移動をそのまま使うため、ここには書かない。

**火曜 10/6**

集中プラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–9:15 | task | ゼミレポート執筆（`task_report`・完了） | 自宅 |
| 9:15–9:30 | buffer | バッファ | 自宅 |
| 9:30–10:30 | task | TOEIC リスニング演習（`task_toeic_listening`） | 自宅 |
| 10:30–11:30 | free | 自由時間 | 自宅 |
| 16:50–17:05 | buffer | バッファ | カフェ |
| 17:05–17:35 | task | TOEIC 単語（`task_toeic_vocab`） | カフェ |
| 17:35–18:00 | free | 自由時間 | カフェ |
| 22:45–23:00 | buffer | バッファ | 自宅 |
| 23:00–24:00 | free | 自由時間 | 自宅 |

バランスプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–11:30 | free | 自由時間 | 自宅 |
| 16:50–17:05 | buffer | バッファ | カフェ |
| 17:05–17:35 | task | TOEIC 単語（`task_toeic_vocab`） | カフェ |
| 17:35–18:00 | free | 自由時間 | カフェ |
| 22:45–23:00 | buffer | バッファ | 自宅 |
| 23:00–24:00 | free | 自由時間 | 自宅 |

ゆとりプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–11:30 | free | 自由時間 | 自宅 |
| 16:50–17:05 | buffer | バッファ | カフェ |
| 17:05–17:35 | task | TOEIC 単語（`task_toeic_vocab`） | カフェ |
| 17:35–18:00 | free | 自由時間 | カフェ |
| 22:45–23:00 | buffer | バッファ | 自宅 |
| 23:00–24:00 | free | 自由時間 | 自宅 |

**水曜 10/7**

集中プラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–8:45 | task | ES下書き（`task_es_a`・完了） | 自宅 |
| 8:45–9:00 | buffer | バッファ | 自宅 |
| 9:00–9:45 | free | 自由時間 | 自宅 |
| 13:00–13:15 | buffer | バッファ | 大学 |
| 13:15–14:15 | task | TOEIC リスニング演習（`task_toeic_listening`） | 大学 |
| 14:15–14:30 | free | 自由時間 | 大学 |
| 17:05–17:20 | buffer | バッファ | 自宅 |
| 17:20–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–22:00 | task | 企業研究（`task_research`） | 自宅 |
| 22:00–24:00 | free | 自由時間 | 自宅 |

バランスプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–9:15 | task | TOEIC リスニング演習（`task_toeic_listening`） | 自宅 |
| 9:15–9:45 | free | 自由時間 | 自宅 |
| 13:00–14:30 | task | ゼミレポート執筆（`task_report`・完了・大学13:00〜） | 大学 |
| 17:05–17:20 | buffer | バッファ | 自宅 |
| 17:20–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

ゆとりプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–9:15 | task | ゼミレポート執筆（`task_report`） | 自宅 |
| 9:15–9:45 | free | 自由時間 | 自宅 |
| 13:00–13:15 | buffer | バッファ | 大学 |
| 13:15–14:15 | task | TOEIC リスニング演習（`task_toeic_listening`） | 大学 |
| 14:15–14:30 | free | 自由時間 | 大学 |
| 17:05–17:20 | buffer | バッファ | 自宅 |
| 17:20–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

**木曜 10/8**

集中プラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 11:25–11:55 | task | 授業資料の整理（`task_notes`） | 自宅 |
| 11:55–12:00 | free | 自由時間 | 自宅 |
| 12:45–13:00 | buffer | バッファ | 自宅 |
| 13:00–14:30 | task | TOEIC リスニング演習（`task_toeic_listening`） | 自宅 |
| 14:30–14:45 | buffer | バッファ | 自宅 |
| 14:45–15:15 | task | 企業研究（`task_research`） | 自宅 |
| 15:15–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

バランスプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 11:25–12:00 | free | 自由時間 | 自宅 |
| 12:45–13:00 | buffer | バッファ | 自宅 |
| 13:00–14:00 | task | ES下書き（`task_es_a`・完了） | 自宅 |
| 14:00–14:15 | buffer | バッファ | 自宅 |
| 14:15–15:45 | task | TOEIC リスニング演習（`task_toeic_listening`） | 自宅 |
| 15:45–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

ゆとりプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 11:25–12:00 | free | 自由時間 | 自宅 |
| 12:45–13:00 | buffer | バッファ | 自宅 |
| 13:00–14:00 | task | ゼミレポート執筆（`task_report`・完了） | 自宅 |
| 14:00–14:15 | buffer | バッファ | 自宅 |
| 14:15–15:45 | task | TOEIC リスニング演習（`task_toeic_listening`） | 自宅 |
| 15:45–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

**金曜 10/9**

集中プラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ（候補：`task_mail`） | 自宅 |
| 8:15–9:45 | free | 自由時間 | 自宅 |
| 15:25–15:40 | buffer | バッファ | 自宅 |
| 15:40–18:45 | free | 自由時間 | 自宅 |
| 21:15–21:30 | buffer | バッファ | 自宅 |
| 21:30–24:00 | free | 自由時間 | 自宅 |

バランスプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ（候補：`task_mail`） | 自宅 |
| 8:15–9:45 | free | 自由時間 | 自宅 |
| 15:25–15:40 | buffer | バッファ | 自宅 |
| 15:40–18:45 | free | 自由時間 | 自宅 |
| 21:15–21:30 | buffer | バッファ | 自宅 |
| 21:30–24:00 | free | 自由時間 | 自宅 |

ゆとりプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–9:45 | free | 自由時間 | 自宅 |
| 15:25–15:40 | buffer | バッファ | 自宅 |
| 15:40–18:45 | free | 自由時間 | 自宅 |
| 21:15–21:30 | buffer | バッファ | 自宅 |
| 21:30–24:00 | free | 自由時間 | 自宅 |

**土曜 10/10**

集中プラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–9:45 | free | 自由時間 | 自宅 |
| 15:15–15:30 | buffer | バッファ | 自宅 |
| 15:30–16:00 | task | TOEIC 単語（`task_toeic_vocab`） | 自宅 |
| 16:00–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

バランスプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–9:45 | free | 自由時間 | 自宅 |
| 15:15–15:30 | buffer | バッファ | 自宅 |
| 15:30–16:30 | task | TOEIC リスニング演習（`task_toeic_listening`） | 自宅 |
| 16:30–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

ゆとりプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–9:15 | task | ES下書き（`task_es_a`） | 自宅 |
| 9:15–9:45 | free | 自由時間 | 自宅 |
| 15:15–15:30 | buffer | バッファ | 自宅 |
| 15:30–16:30 | task | TOEIC リスニング演習（`task_toeic_listening`） | 自宅 |
| 16:30–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

**日曜 10/11**

集中プラン（タスクなし・休息日）

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–12:00 | free | 自由時間 | 自宅 |
| 13:30–13:45 | buffer | バッファ | 自宅 |
| 13:45–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

バランスプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–9:15 | task | TOEIC リスニング演習（`task_toeic_listening`） | 自宅 |
| 9:15–9:30 | buffer | バッファ | 自宅 |
| 9:30–10:30 | task | 企業研究（`task_research`） | 自宅 |
| 10:30–12:00 | free | 自由時間 | 自宅 |
| 13:30–13:45 | buffer | バッファ | 自宅 |
| 13:45–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

ゆとりプラン

| 時間 | kind | 内容 | 場所 |
|---|---|---|---|
| 8:00–8:15 | buffer | バッファ | 自宅 |
| 8:15–9:15 | task | ES下書き（`task_es_a`・完了） | 自宅 |
| 9:15–9:30 | buffer | バッファ | 自宅 |
| 9:30–11:00 | task | TOEIC リスニング演習（`task_toeic_listening`） | 自宅 |
| 11:00–12:00 | free | 自由時間 | 自宅 |
| 13:30–13:45 | buffer | バッファ | 自宅 |
| 13:45–19:00 | free | 自由時間 | 自宅 |
| 19:45–20:00 | buffer | バッファ | 自宅 |
| 20:00–24:00 | free | 自由時間 | 自宅 |

### 5.10 再計画「今日は疲れた」（バランスプラン・10/5 18:00）

**intent**

```json
{
  "type": "state_change",
  "fatigue": "high",
  "task_changes": [],
  "new_fixed_events": [],
  "preference_changes": []
}
```

**Before**：5.9 のバランスプラン月曜。ただし 18:00 時点なので、13:00–14:30 のレポート執筆は `status: "completed"`、18:00 より前に終わった項目はすべて `locked: true`。

**After（18:00 以降）**

| 時間 | kind | 内容 |
|---|---|---|
| 18:00–18:30 | free | 休憩 |
| 18:30–18:50 | task | TOEIC 単語（20分） |
| 18:50–19:00 | buffer | バッファ |
| 19:00–19:45 | fixed | 夕食（変更なし） |
| 19:45–24:00 | free | 自由時間 |

**changes**

| change_type | before | after | reason |
|---|---|---|---|
| replaced | 18:00–19:00 TOEIC リスニング演習 | 18:00–18:30 休憩、18:30–18:50 TOEIC 単語、18:50–19:00 バッファ | 疲労度が高いため、集中力が必要なリスニング演習を、短時間でできる単語学習に切り替えて先に休憩を入れました |
| moved | 19:45–20:45 ES下書き | なし（10/7へ） | 集中力が必要なESは今日は避けました。締切（10/12）には十分間に合います |
| removed | 20:45–21:00 バッファ | なし | 作業がなくなったため、自由時間にまとめました |
| replaced | 21:00–24:00 自由時間 | 19:45–24:00 自由時間 | 夜はゆっくり休めるようにしました |

**other_day_changes**

| change_type | 内容 | moved_to_date | reason |
|---|---|---|---|
| moved | ES下書き 60分 → 10/7（水）20:00–21:00 | 2026-10-07 | 水曜の夜は他の予定が少なく、締切前に余裕を持って終えられます |
| moved | TOEIC 40分 → 10/8（木）リスニングを90分→130分に | 2026-10-08 | 週6時間の目標を保つため、空きの多い木曜に振り替えました |

**summary_message**

> お疲れさまです。今夜は軽めにして、ESは水曜、TOEICの残り40分は木曜に回しました。夕食の予定はそのままで、週6時間の目標とESの締切も守れます。

---

## 6. ダミーデータの検査（`lib/mock/validate.ts`）

3案・再計画の After・振り替え後の各日について、以下を検査する関数を作り、`GET /api/mock/check` で `MockCheckResultSchema`（`{ errors, warnings }`。3章）を返す。**モック完成時に `errors` が0件であること。`warnings` は0件でなくてよいが、内容を作業報告に含める（10.4章のとおり、多くの日で発生する想定）。**

各検査は `ValidationIssueSchema`（3章）の1件として `errors` または `warnings` に積む。`item_id` は対象項目の`id`（日・週全体にまたがる検査は`null`）、`plan_id`・`date`は対象の案・日（不要なら`null`）。

| 検査内容 | 区分 | code |
|---|---|---|
| 各項目の `start_at < end_at` | error | `START_AFTER_END` |
| 同じ日の項目同士が重ならない（隣接はOK） | error | `ITEM_OVERLAP` |
| タスク・バッファ・自由時間が固定予定の時間帯を侵食していない | error | `FIXED_EVENT_OVERLAP` |
| 固定予定（5.6）の時刻・場所がどの案でも同じ | error | `FIXED_EVENT_MISMATCH` |
| 睡眠 0:00–7:30 に何も置かれていない | error | `SLEEP_OVERLAP` |
| `travel` 以外の項目を時刻順に並べたとき、`location_id` が変わる箇所に、移動時間表どおりの長さの `travel` がある（10.5章のとおり、`travel`以外の全項目に`location_id`が入っている前提） | error | `TRAVEL_MISSING` |
| 締切を過ぎたタスクがない | error | `DEADLINE_VIOLATION` |
| タスクとタスクが（移動や固定予定をはさまずに）続くとき、間に15分以上のバッファがある | error | `BUFFER_SHORTAGE` |
| 1日のタスク合計が360分以下 | error | `DAILY_LIMIT_EXCEEDED` |
| `task_id`・`location_id`・`fixed_event_id`・`suggested_task_id` が存在するIDを指している | error | `INVALID_REFERENCE` |
| TOEIC（リスニング＋単語）の週合計が3案とも360分 | error | `GOAL_HOURS_MISMATCH` |
| 1日のバッファ合計が60分以上（タスクの少ない日は自由時間で代替できるため警告扱い） | warning | `BUFFER_SHORTAGE` |

---

## 7. ファイル構成

```text
app/
  (onboarding)/login/page.tsx
  (onboarding)/interview/page.tsx
  (onboarding)/plans/page.tsx
  (main)/layout.tsx          # タブバー付き
  (main)/today/page.tsx
  (main)/calendar/page.tsx
  (main)/replan/page.tsx
  (main)/settings/page.tsx
  api/...                    # 4章のRoute Handlers（mocks/ を import してよいのはここと lib/mock/ だけ）
  page.tsx                   # /login へリダイレクト
components/
  layout/MobileShell.tsx, BottomTabBar.tsx
  timeline/Timeline.tsx, ItemBlock.tsx, ItemDetailSheet.tsx
  chat/ChatBubble.tsx, QuickReplies.tsx, ChatInput.tsx   # /interview と /replan で共用（10.18参照）
  interview/GoalCandidateCard.tsx
  plans/PlanCompareTable.tsx
  replan/ChangeList.tsx
  calendar/MonthGrid.tsx, WeekGrid.tsx
  common/LoadingState.tsx, ErrorState.tsx, EmptyState.tsx, SurfaceCard.tsx, SuggestionCard.tsx
  ui/                        # shadcn が生成
hooks/
  use-api-data.ts            # lib/api.ts の関数を呼び、ローディング・エラー・成功の状態と再試行を返す（1.4）
lib/
  schemas.ts                 # 3章
  labels.ts                  # 表示名・色・アイコン（1.3、6.3・6.8.4の表示名）
  api.ts                     # 画面から呼ぶ fetch 関数（mock_error 対応）。画面が mocks/ の代わりに使う（10.17参照）
  datetime.ts                # JSTでの表示・計算
  mock/store.ts, clock.ts, summarize.ts, validate.ts
  mock/http.ts                # モックAPIで共通に使う処理（待ち時間、x-mock-errorのエラー応答）
  mock/calendar.ts            # カレンダーAPIで共通に使う処理（固定予定の展開、日・週・月の組み立て）
  mock/plans.ts               # スケジュール3案（generate と candidates で共通）
mocks/
  persona.ts                 # 5.1〜5.3
  goal.ts, tasks.ts, fixed-events.ts
  interview-script.ts, goal-candidates.ts
  plans/intensive.ts, balanced.ts, relaxed.ts
  plans/shared.ts             # 3案のデータ定義で共通に使う補助関数
  replan-tired.ts
```

`mocks/` のデータは `.ts` で書き、スキーマの `.parse()` か `satisfies` で型を確かめる。

---

## 8. 実装の順番

1ステップごとに typecheck と lint を通し、コミットする。

1. `lib/schemas.ts`、`lib/labels.ts`、`lib/datetime.ts`
2. `mocks/` のペルソナ・場所・移動・目標・タスク・固定予定
3. `mocks/plans/` の3案と `replan-tired.ts`、`lib/mock/summarize.ts`・`validate.ts`、`GET /api/mock/check` で0件にする
4. `lib/mock/store.ts`・`clock.ts` と、残りのモックAPI
5. 共通部品（MobileShell、BottomTabBar、Timeline、ItemBlock、状態表示）
6. `/login` → `/interview` → `/plans` → `/today` → `/replan` の順に画面
7. `/calendar`（週 → 日 → 月の順）
8. `/settings`
9. 390px幅で通し操作を確認し、`?mock_error=1` でエラー表示を確認

---

## 9. モックでやらないこと

- 本物のログイン・DB・LLM呼び出し
- Planning Engine の計算（配置は5章のデータをそのまま使う）
- カレンダーでのドラッグ・編集
- タスク・固定予定・場所の登録画面
- アニメーションや細かなデザインの作り込み
- デイリーチェックイン（F-07）。状態の入力はモックでは再計画（`/replan`）で代用する
- `POST /api/plans/replan` の再計画は 10/5（デモの今日）だけ対応する。5.10章のデータが月曜分しかないため、`date` が10/5以外のときは「疲れた」と送っても `{ supported: false, ... }` を返す

---

## 10. 決定事項

実装前に確認した不明点・矛盾点への回答をまとめる。番号は確認時の質問番号。

### 10.1 ヒアリング：ユーザー入力不要なステップの返し方（案A）

ユーザーの入力を必要としないステップは、直前の応答にまとめて返す。1回の応答で完結させ、画面側から自動で追加のリクエストは送らない。

- ステップ4（conditions）への回答を送ると、`POST /api/interview/message` 1回の応答で次を返す
  - `step`: `"goal_candidates"`、`step_index`: `6`
  - `messages`: `[ステップ5のAI発言]`
  - `goal_candidates`: 5.8章の3案
  - `quick_replies`: `[]`
- `selection` を送ると、1回の応答で次を返す
  - `step`: `"final_confirmation"`、`step_index`: `9`
  - `messages`: `[ステップ8の要約, ステップ9の確認の発言]`
  - `goal_draft`: 選択を反映したG1（10.3参照）
  - `quick_replies`: `[]`
- ステップ7（user_selection、カードの選択）は画面上の操作だけで、独立したAPI応答はない
- 画面側は `messages` を順に吹き出しで表示し、`goal_candidates` があればその下にカードを表示する

### 10.2 `POST /api/interview/message` のリクエスト形式

- リクエストは `text` と `selection` のどちらか一方だけを送る。両方ある・両方ない場合は400エラー
- この条件は `lib/schemas.ts` の `InterviewMessageRequestSchema`（3章）で、Zodの`refine`により検証する
- `selection.hours_per_week` は1〜15の範囲、0.5刻み（`z.number().min(1).max(15).multipleOf(0.5)`）
- 応答の `messages` にはAIの発言だけを入れる。ユーザーの吹き出しは画面側で表示する
  - `text` のとき：入力した文章をそのまま表示
  - `selection` のとき：`lib/labels.ts` の表示名を使い「『バランス標準型』週6時間にします」の形式で表示
- 本番でも `selection` はLLMに通さず、そのまま `goal_draft` に反映する想定

### 10.3 台本の固定と3案選択の反映

- クイックリプライで◎以外を選んだ場合も、自由入力の内容に関係なく、台本どおり次のステップに進む
  - ユーザーの吹き出しには、押した選択肢・入力した文章をそのまま表示する
  - AIの発言と `goal_draft` の内容（カテゴリ・目標・現状・条件）はG1に固定
  - クイックリプライは◎の選択肢を先頭に並べる
- ただし、3案での選択（`selection`）は反映する
  - `goal_draft` の `user_selected_plan` と `target_hours_per_week` は、選んだ `style` と `hours_per_week` にする
  - ステップ8の要約の文章「TOEIC学習：週◯時間」「今週の合計目標時間：◯時間」も選んだ時間にする
- `POST /api/plans/generate` が返すスケジュール3案は、選択に関係なく5.9章の固定データ（TOEIC週6時間）のまま。これはモックの制限として扱い、デモでは「バランス標準型・6時間」を選ぶ（0.2章参照）
- 3案のカードを表示している間（ステップ6〜7）と、最終確認（ステップ9）の間は自由入力欄を無効にし、それぞれ「上の案から選んでください」「確定ボタンを押してください」と表示する

### 10.4 5.9章「火〜日の詳細」の作成手順

常識的な範囲で埋めてよいが、以下の手順に従う（結果は5.9章に反映済み）。

- 時刻は5分単位
- 5.6章の各「空き」について、先頭から順に次のように置く
  1. 空きが45分以上あるときは、先頭に15分のバッファを置く
  2. その日のタスクを、高集中（レポート・ES・リスニング）→ 軽作業（単語・メール・資料整理）の順に置く
     - 高集中タスクは60分以上の空きに置く。単語は短い空きやカフェ周辺の空きに置いてよい
     - タスクとタスクの間には15分のバッファを置く
  3. 残りは自由時間にする
- 5.9章の割り当て表（火〜日の分数）は変えない
- メール返信（15分）のように「バッファ内」と書かれたタスクは、独立した`task`項目にせず、`buffer`項目に`suggested_task_id`を付けて表す（1.3章の表示規則のとおり）
- この手順どおりに置くと、多くの日で1日のバッファ合計が60分未満になる（6章の`BUFFER_SHORTAGE`警告）。想定では、火（バランス・ゆとり）・水（バランス）・木（集中・バランス・ゆとり）・金（集中・バランス・ゆとり）・土（集中・バランス・ゆとり）・日（集中）で警告が出る。これは意図した結果であり、`errors`が0件であれば問題ない

### 10.5 `location_id` の入れ方

- `travel` 以外のすべての項目に、その時間にいる場所の `location_id` を必ず入れる（`null`にしない）
  - 睡眠・自宅での作業や自由時間は `loc_home`、大学（図書館含む）は `loc_univ`、カフェ周辺の空きは `loc_cafe` など
- `travel` 項目は `location_id: null` とし、`travel` オブジェクトに `from_location_id`・`to_location_id`・`mode` を入れる
- 検査：`travel` 以外の項目を時刻順に並べ、`location_id` が変わる箇所には、その2地点の `travel` が移動時間表（5.3章）どおりの長さで入っていること（6章 `TRAVEL_MISSING`）
- 5.9章の月曜の表・5.10章の再計画データも同じ規則で `location_id` を入れる（自宅の項目は `loc_home`、大学の項目は `loc_univ`）

### 10.6 `/replan` のデモ時刻

- `/replan` を開いた時点で、画面から `POST /api/mock/clock` を呼び、`demo_now` が18:00より前なら18:00にする
- ヘッダーは `demo_now` を表示し、その下に小さく「デモのため、時刻を18:00に進めました」と表示する（すでに18:00以降なら表示しない）
- `POST /api/plans/replan` 側の「18:00に進める」処理は、念のため残す（二重に呼ばれても副作用はない）

### 10.7 「計画を更新しました」トースト

- 「この計画にする」を押すと `/today?updated=1` に遷移する
- `/today` は `updated=1` があれば「計画を更新しました」のトーストを1回表示し、`router.replace` で `/today` に置き換えてクエリパラメータを消す

### 10.8 検査結果の形（`errors` / `warnings`）

`lib/schemas.ts`（3章）に次のスキーマを追加する（既存のスキーマは変更しない）。

- `ValidationIssueSchema`：`{ code, item_id: string | null, message, plan_id: string | null, date: string | null }`
  - `code` は要件定義書6.8.5の検査項目に対応する `ValidationIssueCodeSchema`（`START_AFTER_END`、`ITEM_OVERLAP`、`FIXED_EVENT_OVERLAP`、`SLEEP_OVERLAP`、`TRAVEL_MISSING`、`DEADLINE_VIOLATION`、`BUFFER_SHORTAGE`、`DAILY_LIMIT_EXCEEDED`、`INVALID_REFERENCE`）に、モック専用の `FIXED_EVENT_MISMATCH`・`GOAL_HOURS_MISMATCH` を加えたenum
  - 本番のValidatorも同じ形で返す想定
- `MockCheckResultSchema`：`{ errors: ValidationIssue[], warnings: ValidationIssue[] }`
- 完了条件は `errors` が0件。`warnings` は0件でなくてよいが、内容を作業報告に含める（10.4章のとおり想定あり）
- 1日のバッファ合計60分未満は `warnings` に入れる（`code: "BUFFER_SHORTAGE"`。タスク間15分不足の方はerrorの`BUFFER_SHORTAGE`で、配列（errors/warnings）の違いで区別する）

対応する3章・4章・6章の記述も更新済み。

### 10.9 タスク詳細の表示部品

- shadcnの `Sheet`（`side="bottom"`）に統一する。`Drawer` は使わない
- Base UI版で `Sheet` が使えない場合は、代わりの部品を使う前に報告する

### 10.10 デイリーチェックインの扱い

- モックでは対象外とする（9章に追記済み）。状態の入力は `/replan` の自然言語入力で代用する

### 10.11 `/login` の画面構成とAPI

- メールアドレス欄をなくし、スプラッシュ画面にする（見た目は `docs/design-spec.md` 6章のとおり）
- 下部の白い主ボタンを押すと `POST /api/auth/mock-login` を呼び、`/interview` へ進む
- リクエストは `{ email: string | null }`。スプラッシュからは常に `null` を送る
- 2.1章・4章の表を修正済み

### 10.12 `/today` 下部の導線

- 入力欄風のボタンと「予定の変更をAIに伝える…」の文言はやめ、紫の主ボタン（「航路を調整する」。見た目は `docs/design-spec.md` 5.3参照）に統一する
- 押すと `/replan` へ遷移する。位置はタイムラインのカードの下・タブバーの上に固定

### 10.13 目標に紐づく継続タスクの所要時間・残り時間（5.5章）

`TaskSchema` の `estimated_minutes`・`remaining_minutes` は必須の数値（null不可）のため、`goal_id` を持つ継続タスク（締切なし。5.5章で「残り」が `—` のもの）は次のとおり読み替える。スキーマ自体は変更しない。

- `estimated_minutes`：1回あたりの標準時間
- `remaining_minutes`：今週その目標で残っている時間。同じ `goal_id` のタスクで共有する値で、目標の `target_hours_per_week` × 60 から今週すでに実施した分を引いたもの

値は5.5章の追記のとおり（`task_toeic_listening`：60／360、`task_toeic_vocab`：30／360）。`docs/requirements.md` 6.6にも同じ内容を追記済み。
- 2.4章を修正済み

### 10.14 固定予定（5.6章）の `recurrence` の扱い

- 授業・ゼミ・バイトは `recurrence: "weekly"`
- 朝食・昼食・夕食も `recurrence: "weekly"`。曜日ごとに時刻が違うため、曜日ごとに別の固定予定として登録する
- 友人と夕食（金10/9）・家族と昼食（日10/11）は `recurrence: null`（その週だけの約束）
- 睡眠は固定予定にしない（`UserPreference` から作る）
- 移動は固定予定にしない（計画の項目 `kind: travel` として、ステップ3で作る）
- `recurrence: "weekly"` の予定も `start_at`・`end_at` には今週（10/5〜10/11）の日時を入れ、それを基準に毎週繰り返す。10月の他の週への展開はステップ4のカレンダーAPIで行う

### 10.15 `POST /api/interview/message` の誤った送り方の扱い

- ステップ6〜7（3案のカード表示中）と最終確認（ステップ9）の間は、画面側で自由入力欄を無効にし、それぞれ「上の案から選んでください」「確定ボタンを押してください」と表示する（10.3章）
- 加えて、サーバー側（Route Handler）でも現在のステップに合わない送り方は400エラーで断る。具体的には次の場合に400を返す
  - ステップ1〜4（`text` を待つ状態）で `selection` が送られた、または `text` が無い
  - ステップ6（`selection` を待つ状態）で `text` が送られた、または `selection` が無い
  - ステップ9（最終確認。`POST /api/interview/confirm` の「確定する」ボタンを待つ状態）に `text`・`selection` のどちらが送られても、`message` は受け付けない
- 「画面側で入力を無効にする」＋「サーバー側でも間違った送り方は400で断る」の二重の防御とする。画面の実装が万が一この前提を破っても、サーバー側でおかしな状態遷移が起きないようにするため

### 10.16 スマホの枠（PC表示）

- 画面幅640px以上では、幅390px・高さ844px・角丸40px程度の枠を画面中央に置く。縁取りは `--brand-dark`、影あり。枠の外は `docs/design-spec.md` 5.1の背景
- 640px未満では枠を出さず、画面いっぱいに表示する
- どちらの場合も、本文は枠（画面）の中だけでスクロールし、タブバー・入力欄・主ボタンなどの固定要素は枠の下端に固定される
- `components/layout/MobileShell.tsx` に実装する。下部の固定要素は `position: fixed` を使わず、`MobileShell` の `bottom` に渡す
- 1.1章を修正済み

### 10.17 画面から `mocks/` を直接 import しない・`GET /api/tasks`

- 画面（`app/` の page や `components/`）は `mocks/` を直接 import しない。データは必ず `lib/api.ts` 経由でAPIから受け取る
- `mocks/` を import してよいのは `app/api/` と `lib/mock/` だけ（`AGENTS.md` の「モックとの関係」にも記載）
- タスクの情報（締切バッジ、バッファの候補タスク名など）を画面で使うため、`GET /api/tasks` を追加する。レスポンスは `{ tasks: Task[] }`（既存の `TaskSchema`。`lib/schemas.ts` の変更なし）
- `Timeline` は `tasks` を外から受け取る。画面側は `GET /api/tasks` で取得して渡す
- 4章の表を修正済み

### 10.18 チャット部品の置き場所

- `ChatBubble`・`QuickReplies`・入力欄（`ChatInput`）などのチャット部品は `components/chat/` に置き、`/interview` と `/replan` で共用する
- 7章のファイル構成を修正済み

### 10.19 `/plans` のデータ・上部の表示、APIの形の置き場所

**`/plans` の3案の受け取り方**

- `GET /api/plans/candidates` を追加する。レスポンスは `POST /api/plans/generate` と同じ `{ candidates: ScheduleCandidate[] }`
- `lib/mock/store.ts` に `plans_generated`（初期値 `false`）を持つ。`POST /api/plans/generate` で `true` にし、`POST /api/mock/reset` で `false` に戻す
- `plans_generated` が `false` のときは `{ candidates: [] }` を返す。`/plans` は空の表示「航路プランはまだありません」と「航海の準備へ」ボタン（→ `/interview`）を出す
- `/plans` は画面を開いたときに `GET /api/plans/candidates` を呼ぶ。`generate` の結果はブラウザ（`sessionStorage` など）に保存しない
- 4章の表と4.1章に追記済み

**`/plans` の上部**

- 戻るボタンは出さない（`/interview` に戻るとヒアリングが最初からやり直しになるため）
- 進行状況は出さない（1.2章の「上部に戻るボタンと進行状況」は `/interview` だけに適用する）

**APIのリクエスト・レスポンスの形の置き場所**

- APIのリクエスト・レスポンスの形（`TasksResponseSchema`・`MockLoginResponseSchema`・`InterviewConfirmResponseSchema`・`GeneratePlansResponseSchema`・`PlanCandidatesResponseSchema`・`SelectPlanResponseSchema`・`SettingsResponseSchema` など）は `lib/schemas.ts` に置く
- `app/api/` の Route Handler も `lib/api.ts` も、`lib/schemas.ts` から import する。サーバー側（`app/api/`）は `lib/api.ts` を import しない
