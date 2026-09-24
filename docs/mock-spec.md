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
→ 目標時間3案から「バランス標準型」を選び、確定
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
- PCで開いた場合は、幅 `max-w-[430px]` の枠を画面中央に表示し、外側は薄いグレーにする
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

- 締切のあるタスクには赤いバッジ「締切 10/9」を付ける
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

### 2.1 `/login` ログイン

- アプリ名「Personal AI Secretary」とひとこと説明「予定を考える負担を、AIが引き受けます」
- メールアドレス欄（入力しなくても進める）と「ログイン」ボタン
- 「ログイン」→ `POST /api/auth/mock-login` → `/interview`

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

**下部**：「予定の変更をAIに伝える…」という入力欄風のボタン → `/replan`。その下にタブバー

再計画を確定したあとは、上部に「計画を更新しました」のトーストを出す

### 2.5 `/replan` 予定変更

**上部**：タイトル「予定を変更」、デモ時刻「18:00 現在」

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

// ---------- 型 ----------
export type Location = z.infer<typeof LocationSchema>;
export type TravelTime = z.infer<typeof TravelTimeSchema>;
export type FixedEvent = z.infer<typeof FixedEventSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type GoalTimeCandidate = z.infer<typeof GoalTimeCandidateSchema>;
export type InterviewTurn = z.infer<typeof InterviewTurnSchema>;
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;
export type DayPlan = z.infer<typeof DayPlanSchema>;
export type ScheduleCandidate = z.infer<typeof ScheduleCandidateSchema>;
export type DayView = z.infer<typeof DayViewSchema>;
export type MonthView = z.infer<typeof MonthViewSchema>;
export type ReplanProposal = z.infer<typeof ReplanProposalSchema>;
```

---

## 4. モックAPI

`app/api/` の Route Handlers で実装する。**パスとレスポンスの形は本番と同じ**にし、中身だけ `mocks/` のデータを返す。レスポンスは返す前に必ずスキーマの `.parse()` を通す。

| メソッド・パス | リクエスト | レスポンス | 待ち時間 |
|---|---|---|---|
| `POST /api/auth/mock-login` | `{ email }` | `{ user_id, display_name }` | 400ms |
| `POST /api/interview/start` | なし | `InterviewTurn`（ステップ1） | 400ms |
| `POST /api/interview/message` | `{ session_id, text?, selection?: { style, hours_per_week } }` | `InterviewTurn`（次のステップ） | 800ms |
| `POST /api/interview/confirm` | `{ session_id }` | `{ state: "READY_FOR_PLANNING", goal: Goal }` | 400ms |
| `POST /api/plans/generate` | `{ session_id }` | `{ candidates: ScheduleCandidate[] }`（3件） | 1500ms |
| `POST /api/plans/{id}/select` | なし | `{ active_plan_id }` | 400ms |
| `GET /api/calendar/day?date=` | — | `DayView` | 400ms |
| `GET /api/calendar/week?start=` | — | `{ week_start, days: DayView[] }` | 400ms |
| `GET /api/calendar/month?month=` | — | `MonthView` | 400ms |
| `POST /api/plans/replan` | `{ date, text }` | `ReplanProposal` または `{ supported: false, message }` | 1200ms |
| `POST /api/plans/replan/accept` | `{ proposal_id }` | `DayView` | 400ms |
| `GET /api/settings` | — | `{ preferences, locations, travel_times, goal }` | 400ms |
| `POST /api/mock/clock` | `{ now }` | `{ now }` | 0 |
| `POST /api/mock/reset` | なし | `{ ok: true }` | 0 |
| `GET /api/mock/check` | — | `{ errors: [...] }`（6章の検査結果） | 0 |

- `?mock_error=1` の付いた画面からの呼び出しは、`lib/api.ts` がリクエストヘッダー `x-mock-error: 1` を付け、Route Handler は500を返す
- `interview/message` の `selection` が送られたら、ステップ7→8へ進み、`goal_draft` の `target_hours_per_week` と `user_selected_plan` に反映する

### 4.1 モックの状態（`lib/mock/store.ts`）

サーバーのメモリ上に1人分の状態を持つ（再起動で初期値に戻る）。

| 項目 | 初期値 | 説明 |
|---|---|---|
| `interview_step_index` | 0 | ヒアリングの進み具合 |
| `goal` | 下の G1 | 確定した目標 |
| `active_plan_style` | `"balanced"` | 選択中のプラン |
| `replan_accepted` | `false` | 再計画を確定したか |
| `demo_now` | `2026-10-05T07:00:00+09:00` | デモ時刻 |

初期値でプランが選択済みになっているのは、開発中に `/today` や `/calendar` を直接開いても表示できるようにするため。

- `POST /api/plans/replan` が呼ばれたら、`demo_now` が18:00より前なら18:00に進める（モック専用の動き）
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

### 5.6 固定予定（毎週）と生活の骨組み

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

3案・再計画の After・振り替え後の各日について、以下を検査する関数を作り、`GET /api/mock/check` で結果を返す。**モック完成時にエラー0件であること。**

- 各項目の `start_at < end_at`
- 同じ日の項目同士が重ならない（隣接はOK）
- 固定予定（5.6）の時刻・場所がどの案でも同じ
- 場所が変わるとき、間に移動時間表どおりの `travel` がある
- 睡眠 0:00–7:30 に何も置かれていない
- 締切を過ぎたタスクがない
- 1日のタスク合計が360分以下
- タスクとタスクが（移動や固定予定をはさまずに）続くとき、間に15分以上のバッファがある
- 1日のバッファ合計が60分以上（タスクの少ない金・日などは、自由時間で代替できるので警告のみ）
- TOEIC（リスニング＋単語）の週合計が3案とも360分
- `task_id`・`location_id`・`fixed_event_id` が存在するIDを指している

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
  api/...                    # 4章のRoute Handlers
  page.tsx                   # /login へリダイレクト
components/
  layout/MobileShell.tsx, BottomTabBar.tsx
  timeline/Timeline.tsx, ItemBlock.tsx, ItemDetailSheet.tsx
  interview/ChatBubble.tsx, QuickReplies.tsx, GoalCandidateCard.tsx
  plans/PlanCompareTable.tsx
  replan/ChangeList.tsx
  calendar/MonthGrid.tsx, WeekGrid.tsx
  common/LoadingState.tsx, ErrorState.tsx, EmptyState.tsx
  ui/                        # shadcn が生成
lib/
  schemas.ts                 # 3章
  labels.ts                  # 表示名・色・アイコン（1.3、6.3・6.8.4の表示名）
  api.ts                     # 画面から呼ぶ fetch 関数（mock_error 対応）
  datetime.ts                # JSTでの表示・計算
  mock/store.ts, clock.ts, summarize.ts, validate.ts
mocks/
  persona.ts                 # 5.1〜5.3
  goal.ts, tasks.ts, fixed-events.ts
  interview-script.ts, goal-candidates.ts
  plans/intensive.ts, balanced.ts, relaxed.ts
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
