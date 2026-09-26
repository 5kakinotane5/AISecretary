# 設計書：Backend・AI（4〜9章）

> 設計書（`docs/design/`）の一部。目次・章とファイルの対応は [README.md](README.md)。章番号は設計書全体で共通。

## 4. DB設計（Supabase）

### 4.1 方針

- SQL の正は `supabase/migrations/` のファイル（`0001_init.sql`・`0002_functions.sql`）。Supabase ダッシュボードの SQL Editor に貼り付けて、番号順に1回だけ実行する（Supabase CLI は使わない）。変えるときは新しい番号のファイルを足し、実行したことを PR の説明に書く
- 型：日時は `timestamptz`、日付は `date`、ID は `uuid default gen_random_uuid()`
- すべての表に `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade` と RLS を付ける
- 複数の表をまとめて変える操作（案の保存・選択・目標の確定・再計画の確定）は、4.4 の SQL 関数（`supabase.rpc()`）で1トランザクションにする

### 4.2 テーブル（`supabase/migrations/0001_init.sql`）

列・制約は SQL ファイルを見る。ここでは表の役割と、実装で気をつける点だけを書く。

| 表 | 内容 | 気をつける点 |
|---|---|---|
| `locations` | 場所 | |
| `user_settings` | 生活リズム・表示名（要件定義の users / user_preferences） | 主キーは `user_id`。`home_location_id` は必須（先に locations を入れる）。`demo_now`（1.3）、`preference_weights`（P9.2） |
| `travel_times` | 移動時間表 | `(user_id, from, to)` で一意。往復は2行 |
| `fixed_events` | 固定予定 | `recurrence` は `weekly` か null |
| `goals` | 目標 | 有効（`active`）は利用者ごとに1件（部分ユニークインデックス）。時間帯の希望 `weekday_time_band`・`weekend_time_band`。`created_at` は confirm のときの `getNow()` を入れる |
| `tasks` | タスク | 目標タスクは `goal_id` あり（目標を消すと一緒に消える）。分は5の倍数 |
| `task_done_logs` | 計画を選び直す前に実施済みだった分 | `select_plan` だけが書く（8.2） |
| `daily_checkins` | チェックイン | `(user_id, date)` で一意 |
| `interview_sessions`・`interview_messages` | ヒアリング | `state` には `ABANDONED` もある（画面には返さない） |
| `weekly_plans` | 3案と選んだ案 | 有効（`active`）は利用者ごとに1件。`generation_id` は同時に作った3案で共通。`version` は項目を変えるたびに +1。`features`（P6） |
| `daily_plan_items` | 計画の項目 | `carried`：作り直しのとき前の計画から写した過去の項目（8.2） |
| `replan_proposals` | 再計画の提案 | `updated_days`・`new_fixed_events` は accept でそのまま入れる行 |

**補正 C-2**：要件定義 8.1 の `daily_plans` は作らない（`daily_plan_items.date` で日を表す）。

### 4.3 RLS

全テーブルで RLS を有効にし、「本人の行だけ」（`user_id = auth.uid()`）のポリシーを1つずつ付けている（`0001_init.sql` の最後）。すべての表の `user_id` の既定値は `auth.uid()` なので、利用者のセッション付きクライアントで insert すれば自動で入る。

外部キーの先が同じ利用者のデータであることは、アプリ側で「参照先を自分のクライアントで読めること」を確かめて保証する（読めなければ 400 `INVALID_REQUEST`）。

### 4.4 トランザクション用の関数（`supabase/migrations/0002_functions.sql`）

すべて `security invoker`（呼んだ利用者の権限で動き、RLS が効く）。実行できるのは `authenticated`（ログイン中の利用者）だけにしている（`anon` と `public` からは revoke）。API からは `supabase.rpc("関数名", { 引数 })` で呼ぶ。エラーは `raise exception '<CODE>'` で投げるので、API はエラーの message の CODE を見て 2.2 のエラーに変換する。

| 関数 | 何をするか | 投げるエラー | 呼ぶ API |
|---|---|---|---|
| `save_generation(p_session_id, p_plans, p_items)` | 前の候補を discarded にし、3案（`features` を含む）と項目を入れ、セッションを PLAN_PROPOSED にする | `NOT_FOUND`（セッションがない） | `POST /api/plans/generate`（11.1） |
| `select_plan(p_plan_id, p_now)` | 今までの有効な計画の実施済み（`carried = false`、`end_at ≤ p_now` のタスク）を `task_done_logs` に写し、その案を active に、同じ生成の他の2案と前の active を discarded にする。`version` +1 | `NOT_FOUND`（候補でない） | `POST /api/plans/{id}/select`（11.1） |
| `confirm_goal(p_session_id, p_goal, p_tasks)` | 前の有効な目標の目標タスクを消して目標を archived にし、新しい目標と目標タスクを入れ、セッションを READY_FOR_PLANNING にする。目標の id を返す | `NOT_FOUND`（セッションがない） | `POST /api/interview/confirm`（8.1） |
| `apply_replan(p_proposal_id)` | 提案の予定を `fixed_events` に入れ、影響のある日の項目を置き換え、`version` +1、提案を accepted（同じ日の他の pending は discarded） | `NOT_FOUND`、`PROPOSAL_EXPIRED`（pending でない・期限切れ・計画の version が違う） | `POST /api/plans/replan/accept`（12.6） |

- `p_plans`・`p_items`・`p_goal`・`p_tasks` と提案の `updated_days`・`new_fixed_events` の JSON は、テーブルの列名と同じキーを**すべて**持つ行にする（`id`・`user_id`・`created_at` も含める。`id` は API が `crypto.randomUUID()` で作る）。足りないキーは null になり、not null の列でエラーになる
- `expires_at` は実際の時刻（`now()`）で判定する（デモ時刻ではない）。有効期間は作成から30分

### 4.5 seed とデモ用アカウント（`lib/server/seed.ts`）

`seedDemoUser(supabase, userId)`：利用者のセッション付きクライアントで、`mocks/` の内容を次の順に入れる。モックの読みやすい ID（`loc_home`・`task_report` など）は、入れるときに新しい UUID に置き換え、参照（`location_id` など）も置き換え表で付け替える。

| 順 | 表 | 元データ | 備考 |
|---|---|---|---|
| 1 | locations | `mocks/persona.ts` の `LOCATIONS` | |
| 2 | user_settings | `USER_PREFERENCE`、`PERSONA_DISPLAY_NAME` | `home_location_id` = `loc_home` の新ID、`demo_now` = `2026-10-05T07:00:00+09:00` |
| 3 | travel_times | `TRAVEL_TIMES` | |
| 4 | fixed_events | `FIXED_EVENTS` | |
| 5 | tasks | `TASKS` のうち `goal_id` が null のもの | 目標タスク（TOEIC の2件）は入れない（8.2 で作る） |

目標・計画・ヒアリングは入れない。

**デモ用アカウント**（`POST /api/auth/mock-login`、5.2）：

1. `DEMO_USER_EMAIL`・`DEMO_USER_PASSWORD` でサインイン
2. 失敗し、かつデモモードなら、`createAdminClient().auth.admin.createUser({ email, password, email_confirm: true })` で作ってからサインインし直す
3. `user_settings` がなければ `seedDemoUser` を実行する

**リセット**（`POST /api/mock/reset`）：ログイン中の利用者の行を、`replan_proposals` → `weekly_plans`（`daily_plan_items` は連鎖で消える）→ `interview_sessions`（`interview_messages` も連鎖）→ `daily_checkins` → `tasks` → `goals` → `fixed_events` → `travel_times` → `user_settings` → `locations` の順に削除し、`seedDemoUser` を実行する。

### 4.6 SQL の動作確認（済み）

2つの SQL ファイルは、PGlite（WebAssembly で動く PostgreSQL）に Supabase の `auth.uid()` と `authenticated` ロールのまねを作って実行し、次を確かめた。

- 2つのファイルがエラーなく実行できる
- 利用者のセッションで seed の行を入れられる。別の利用者からは見えず、別の利用者の `user_id` では入れられない（RLS）
- `confirm_goal`：2回目の確定で、前の目標が archived、目標タスクが入れ替わる
- `save_generation`・`select_plan`：候補3件、有効な計画は常に1件、選び直すと実施済みの分が `task_done_logs` に入る。discarded の案や他人の案は `NOT_FOUND`
- `apply_replan`：その日の項目が置き換わり、予定が `fixed_events` に入り、`version` が +1。同じ提案・古い提案は `PROPOSAL_EXPIRED`
- 4.5 のリセットの順で全部消える
- 未ログイン（`anon`）では4つの関数を実行できない

Supabase 本体では未実行。最初に SQL Editor で実行したら、ダッシュボードの Table Editor で13の表と RLS（鍵のマーク）ができていることを確かめる。

## 5. 認証（F-01）優先度S

### 5.1 機能要件

| ID | 要件 |
|---|---|
| FR-01-1 | `/login` の主ボタン1つでデモ用アカウントにログインし、`/interview` へ進む（モックと同じ） |
| FR-01-2 | 未ログインで `/login` 以外の画面を開くと `/login` へリダイレクトする |
| FR-01-3 | 未ログインで API（`/api/auth/*` 以外）を呼ぶと401 |
| FR-01-4 | 他の利用者のデータは取得・変更できない（RLS と `requireUser()` の二重で守る） |
| FR-01-5 | `POST /api/auth/logout` でログアウトできる（ボタンは作らない。優先度B） |
| FR-01-6 | メールアドレスとパスワードを入力するログイン画面は作らない（優先度B） |

### 5.2 詳細設計

- 認証方式：Supabase Auth のメールアドレス＋パスワード
- `lib/server/supabase.ts`：`@supabase/ssr` の `createServerClient` に、`next/headers` の `cookies()`（Next.js 16 では `await cookies()`）の `getAll`・`setAll` を渡して作る
- `POST /api/auth/mock-login`（パス・形はモックと同じ）
  - `{ email: null }` のとき、4.5 の手順でデモ用アカウントにサインインし、セッションを Cookie に保存する
  - `email` が文字列なら 400（FR-01-6）
  - レスポンス：`{ user_id, display_name }`（`display_name` は `user_settings`）
- `proxy.ts`：Supabase の SSR ガイドの形で、リクエストごとに `supabase.auth.getUser()` を呼んでセッションを更新し、ユーザーがいなければ `/login` にリダイレクトする
  - 対象外（`config.matcher` で除く）：`/login`、`/api/*`、`/_next/*`、静的ファイル（拡張子付きのパス）
- `requireUser()`：`supabase.auth.getUser()` でユーザーを取り、いなければ `HttpError(401, "UNAUTHORIZED", "ログインしてください")`
- `app/page.tsx`（`/`）：ログイン済みなら `/today`、未ログインなら `/login` にリダイレクト（**補正 C-3**）
- 画面側：API が401を返したら `/login` に移す（14.1）

### 5.3 受け入れテスト

- [ ] 未ログインで `/today` を開くと `/login` に移る
- [ ] 未ログインで `GET /api/tasks` が401
- [ ] 別の利用者のタスク ID で `PATCH /api/tasks/{id}` を呼ぶと404
- [ ] 新しい Supabase プロジェクトで初めてログインボタンを押すと、デモ用アカウントが作られ、seed が入り、`/interview` に進む
- [ ] 2回目のログインでは seed が重複しない

## 6. ヒアリング（F-02）優先度S

### 6.1 機能要件

| ID | 要件 |
|---|---|
| FR-02-1 | `POST /api/interview/start`：新しいセッションを作り、ステップ1の質問とクイックリプライを返す。進行中の古いセッションは `ABANDONED` にする |
| FR-02-2 | 利用者の発言から各ステップの項目（6.2.2）を抽出して保存する。発言にない値は null（推測しない） |
| FR-02-3 | AIの発言は1回に質問1〜2個。選択肢で答えられる質問にはクイックリプライ（最大5個、各20文字以内）を付ける |
| FR-02-4 | 聞き直しの回数に上限を設け、会話が終わらない状態を作らない（6.2.2） |
| FR-02-5 | ステップ4の回答を受けたら、1回の応答でステップ5の発言と目標時間3案（F-03）を返す（mock-spec 10.1） |
| FR-02-6 | `selection` を受けたら、1回の応答でステップ8の要約とステップ9の確認を返す（mock-spec 10.1） |
| FR-02-7 | `POST /api/interview/confirm`：目標を確定し、状態を `READY_FOR_PLANNING` にする。**スケジュールは生成しない** |
| FR-02-8 | ステップに合わない送り方は400（mock-spec 10.15 と同じ判定） |
| FR-02-9 | 不正な状態遷移は409 `INVALID_STATE` |
| FR-02-10 | 発言は DB に保存する。再読み込み後の会話の復元は作らない（優先度B。再読み込みしたら start からやり直し） |
| FR-02-11 | LLM の抽出が失敗したら502。**状態も発言も保存しない**（画面の「再試行」で同じ文をもう一度送れる） |

### 6.2 詳細設計

#### 6.2.1 処理の分担

ステップの進行は**サーバーが決める**。LLM は「発言からの項目抽出」と「次の発言の文章」だけを作る。

```text
POST /api/interview/message（text）
  1. セッションを読む。state と step_index が 10.15 の条件に合わなければ 400
  2. LLM_MODE=on：LLM で抽出（6.2.3）／ off：台本（6.2.6）
  3. 抽出結果を slots にマージ（null・空配列では上書きしない）
  4. このステップの判定（6.2.2）→ 次のステップ or 聞き直し
  5. 利用者の発言・AIの発言・セッションを保存（まとめて。途中で失敗したら 500 で、状態は進めない）
  6. InterviewTurn を返す
```

#### 6.2.2 ステップと抽出項目・聞き直し

| step | 抽出する slots | 進む条件 | 聞き直し（上限） | 上限に達したら |
|---|---|---|---|---|
| 1 category | `category` | category が入った | 1回 | 「その他」にして進む |
| 2 goal | `goal_text`、`task_name`（15文字以内の短い名前） | task_name が入った | 2回 | task_name = カテゴリ名（「その他」なら「目標」）にして進む |
| 3 current_status | `current_status` | 何か答えた（「分からない」でも可） | 0回 | そのまま進む |
| 4 conditions | `deadline`、`conditions`、`explicit_hours_per_week`、`frequency_per_week`、`weekday_time_band`・`weekend_time_band`（「平日は夜が中心」→ 平日 evening。言っていなければ null） | 何か答えた（「未定」でも可） | 0回 | そのまま進む |

- 聞き直しの回数は `interview_sessions.retry_count`（ステップが進んだら0に戻す）。聞き直しでは `step_index` を変えない
- クイックリプライ：ステップ1は固定の5択（`INTERVIEW_CATEGORIES`）。ステップ2〜4は LLM の案（ステップ4は末尾に「未定」を必ず足す）
- `deadline`：年がない日付（「12月13日」）は `now` 以降で最も近い日付にする（日付の正規化であり推測ではない）。「年内」「来月くらい」など日が決まらない表現は null にし、原文を `conditions` に残す。`now` より前の日付になったものは null
- `priority` は質問しない。初期値 `"medium"`（**補正 C-4**）
- 時間帯（`weekday_time_band`・`weekend_time_band`）は、利用者が時間帯を言った場合だけ入れる。「朝」「午前」→ morning、「昼」「午後」→ daytime、「夕方」「夜」→ evening。「平日は」「土日は」の区別がなければ両方に同じ値を入れる。原文は `conditions` にも残す。時間帯を聞くための追加の質問はしない（ステップ4の質問文に「勉強しやすい時間帯」を含めるだけ。mock-spec 5.7 の台本と同じ）
- ステップ4で上限に達したときや task_name を仮置きしたときは、要約（6.2.5）の末尾に「内容が違う場合は、設定の『新しい目的地を相談する』からやり直せます。」を付ける

#### 6.2.3 LLM：抽出＋次の発言（`lib/llm/interview.ts`）

- 入力（JSON）：`current_step`、`next_step`（サーバーが決める。聞き直しなら `current_step` と同じ）、`slots`、直近6発言、今回の発言、今日の日付、`categories`
- 出力：`InterviewLlmSchema` → `extracted` を `InterviewExtractedCheckedSchema` で検証（3.3）
- システムプロンプトの要点（プロンプト集の Prompt 05 に追記する）：
  - 発言に書かれていない値は必ず null。推測・補完・一般論での穴埋めをしない
  - 目標時間・スケジュール・曜日の割り当てを提案しない
  - `next_message` は `next_step` についての質問だけにする。質問は2個まで。丁寧語で、1文を短く
- **ステップ5の発言は LLM を使わずテンプレートで作る**：「ありがとうございます。{期限があれば『{期限の説明}まで約{N}週間です。』}登録済みの授業・バイトの予定もふまえて、目標時間の案を3つ作りました。どれも正解・不正解はないので、しっくりくるものを選んでください。」

#### 6.2.4 状態遷移

| 現在の状態 | 操作 | 次の状態 |
|---|---|---|
| なし／任意 | start | 新しいセッション：INTERVIEWING（step 1）。古い進行中のセッション（INTERVIEWING・CONFIRMING）は ABANDONED |
| INTERVIEWING | message（text、step 1〜4） | INTERVIEWING（step 2〜4、または step 6） |
| INTERVIEWING（step 6） | message（selection） | CONFIRMING（step 9） |
| CONFIRMING | confirm | READY_FOR_PLANNING（`COMPLETED` は通過点として扱い、保存しない） |
| READY_FOR_PLANNING・PLAN_PROPOSED | plans/generate | 成功：PLAN_PROPOSED。失敗（422・500）：元の状態のまま |
| PLAN_PROPOSED | plans/{id}/select | PLAN_PROPOSED（変わらない） |

- 上の表にない組み合わせは409
- `PLANNING` は保存しない（生成は1リクエストの中で終わり、同時に2回押されても `save_generation` が最後の結果だけを候補に残すため）

#### 6.2.5 要約（ステップ8）

要件定義 6.2.4 の定型文を**テンプレートで**作る（**補正 C-13**）。

- `[タスク名]`＝`task_name`、`[目標時間/頻度]`＝「週{selection の時間}時間」、`[補足条件や期限]`＝期限（「12/13受験予定」ではなく「12/13まで」の形）と `conditions` を「・」でつないだもの。何もなければ括弧ごと省く
- `⏱️ 今週の合計目標時間`：selection の時間
- 登録済みの締切タスクのうち、今日から14日以内に締切があるもの（締切の早い順に最大2件）を、末尾に「登録済みの{タイトル}（{M/D}締切）{と…}も一緒に考慮します。」として付ける

ステップ9の発言：「この内容で確定してよいですか？あとから変更もできます。」（固定）

#### 6.2.6 LLM_MODE=off の台本（`lib/server/interview-script.ts`）

モック（mock-spec 5.7・10.1・10.3）と同じ動きを DB 上で行う。

- AIの発言・クイックリプライは `mocks/interview-script.ts` のもの
- 入力の内容に関係なく次のステップに進む。slots はG1（`mocks/goal.ts`）の値で埋める。時間帯は平日 evening、週末 null（G1 の条件「平日は夜が中心」に当たる）
- 3案は 7.2 のルールで計算する（G1 の条件なので 9 / 6 / 3）。文章はテンプレート
- `selection` は反映する（モックと同じ）
- confirm で作る目標タスクは、`mocks/tasks.ts` のうち G1 に紐づく2件（TOEIC リスニング演習・TOEIC 単語）と同じ名前・属性にする（8.2 のテンプレートは使わない）

### 6.3 受け入れテスト

- [ ] 台本どおりに答えると、step 6 で3案、selection 後に step 9 と定型文の要約が返る（`LLM_MODE=on` と `off` の両方）
- [ ] ステップ4で「未定」と答えると `deadline: null`、`conditions: []` で先に進む
- [ ] ステップ2で3回続けて「分からない」と答えると、task_name がカテゴリ名になって先に進む
- [ ] 目標の発言に期限がないとき、`goal_draft.deadline` が null
- [ ] ステップ1〜4で `selection` を送ると400、ステップ9で `message` を送ると400
- [ ] `READY_FOR_PLANNING` になる前に `plans/generate` を呼ぶと409
- [ ] confirm しただけでは `weekly_plans` に行が増えない
- [ ] LLM がタイムアウトすると502で、`interview_messages` が増えていない

## 7. 目標時間3候補（F-03）優先度S

### 7.1 機能要件

| ID | 要件 |
|---|---|
| FR-03-1 | 3案（intensive / balanced / paced）の週あたり時間を**ルールで計算する**（**補正 C-14**） |
| FR-03-2 | 各案の特徴・メリット・注意点・理由の文章は LLM が書く（`off` と失敗時はテンプレート）。数値は変えさせない |
| FR-03-3 | 3案の時間は必ず `paced < balanced < intensive`、1〜15時間、0.5刻み |
| FR-03-4 | 画面はモックのまま（同じ大きさで並べ、推薦として強調しない） |
| FR-03-5 | 選択後の±0.5時間の調整と、選んだ値の `goal_draft` への反映はモックと同じ（`selection` は LLM に通さない） |

### 7.2 詳細設計（`lib/planning/goal-candidates.ts`）

#### 7.2.1 基準値（base）

```text
1. explicit_hours_per_week がある → base = その値
2. frequency_per_week がある → base = frequency_per_week × メインの1回の時間（8.2 のテンプレート）÷ 60
3. どちらもない → base = カテゴリの初期値 × 期限係数
```

| カテゴリ | 初期値（時間/週） | | 期限までの週数 | 期限係数 |
|---|---|---|---|---|
| 資格・テスト勉強 | 6 | | 4週以内 | 1.5 |
| 筋トレ・運動 | 3 | | 5〜8週 | 1.2 |
| 大学の課題・レポート | 4 | | 9週以上・期限なし | 1.0 |
| 就活 | 5 | | | |
| その他 | 4 | | | |

週数 = `ceil((期限の日付 − 今日の日付) ÷ 7)`。

#### 7.2.2 3案の時間

```text
1. intensive = base × 1.5、balanced = base、paced = base × 0.5
2. それぞれ 0.5 刻みに四捨五入し（`Math.round(x * 2) / 2`）、1〜15 に収める
3. 上限：intensive = min(intensive, 上限)。上限 = max(3, 今週の空きの合計[時間] × 0.4 を 0.5 刻みに切り下げ)
   （空きは 10.4〜10.5 を now から日曜まで計算したもの）
4. 下向きの調整：balanced = min(balanced, intensive − 0.5)、paced = min(paced, balanced − 0.5)
5. 上向きの調整（paced が 1 未満になった場合）：paced = 1、balanced = max(balanced, 1.5)、intensive = max(intensive, 2)
```

デモ（TOEIC・期限10週・時間の指定なし）：base = 6 → **9 / 6 / 3**（mock-spec 5.8 と同じ）。

| 項目 | 決め方 |
|---|---|
| `expected_load` | intensive=high、balanced=medium、paced=low |
| `period_weeks` | 期限までの週数。期限なしは null |
| `label` | 短期集中型／バランス標準型／マイペース型（`lib/labels.ts`） |

#### 7.2.3 文章（`lib/llm/goal-candidates.ts`）

- 入力：3案の数値、`task_name`、`current_status`、`conditions`、`deadline`、曜日ごとの固定予定の一言（例：「火・土はバイト」。サーバーが fixed_events から作る）
- 出力：`GoalCandidateTextsLlmSchema`。各文60文字以内。3件でなければテンプレート
- 検証：文中の「◯時間」「◯h」の数値が、その案の時間と違えばその案をテンプレートに置き換える
- テンプレート（`{h}` は時間、`{name}` は task_name）：

| style | characteristics | merit | caution | reason |
|---|---|---|---|---|
| intensive | 毎日まとまった時間を確保 | 目標に余裕を持って届きやすい | 忙しい曜日は負担が大きくなりやすい | {name}を短期間で進めたい場合の目安です |
| balanced | 週5日ほど、無理のない量で継続 | ほかの予定と両立しやすい | 苦手な分野は早めに重点化が必要 | {name}を標準的なペースで進める目安です |
| paced | 空き時間に少しずつ | 負担が小さく続けやすい | 目標には追加の時間が必要になる可能性があります | 忙しい時期でも途切れずに続けたい場合の目安です |

### 7.3 受け入れテスト（`lib/planning/__tests__/goal-candidates.test.ts`）

入力は `computeGoalCandidateHours({ category, deadline, today, explicit_hours_per_week, frequency_per_week, main_minutes, weekly_free_minutes })`。今日はすべて `2026-10-05`、`main_minutes` は 60（6行目だけ、筋トレのメインの 45。8.2）。

| # | category | deadline | explicit | frequency | weekly_free_minutes | 期待（intensive / balanced / paced） | 確かめること |
|---|---|---|---|---|---|---|---|
| 1 | 資格・テスト勉強 | 2026-12-13（10週） | null | null | 2400（40時間） | 9 / 6 / 3 | 基本（上限16に当たらない） |
| 2 | 資格・テスト勉強 | null | 5 | null | 2400 | 7.5 / 5 / 2.5 | 時間の指定 |
| 3 | その他 | null | 1 | null | 2400 | 2 / 1.5 / 1 | 下限と上向きの調整 |
| 4 | その他 | null | 12 | null | 2400 | 15 / 12 / 6 | 18 → 15 に収める |
| 5 | 資格・テスト勉強 | 2026-12-13 | null | null | 600（10時間） | 4 / 3.5 / 3 | 上限4と下向きの調整 |
| 6 | 筋トレ・運動 | null | null | 3 | 2400 | 3.5 / 2.5 / 1 | 回数からの base（3 × 45 ÷ 60 = 2.25。3.375 → 3.5、2.25 → 2.5、1.125 → 1） |
| 7 | 就活 | 2026-10-26（3週） | null | null | 2400 | 11.5 / 7.5 / 4 | 期限係数 1.5（5 × 1.5 = 7.5。11.25 → 11.5、3.75 → 4） |

- [ ] 上の7件
- [ ] 文章（7.2.3）に違う数値があるとき、その案だけテンプレートになる（`lib/llm/` 側のテスト。LLM は呼ばず、関数に文章を渡して確かめる）

## 8. Goal Handoff（F-04）優先度S

### 8.1 機能要件

| ID | 要件 |
|---|---|
| FR-04-1 | confirm で `goal_draft` を `goals` に保存する（`status: active`）。**有効な目標は1件だけ**とし、以前の有効な目標は `archived` にして、その目標タスクを削除する（`confirm_goal`） |
| FR-04-2 | 会話履歴は Planning Engine に渡さない。Engine が受け取るのは `PlanningContext` だけ |
| FR-04-3 | 存在しない情報は null または空配列 |
| FR-04-4 | confirm で目標タスクを作る（8.2） |
| FR-04-5 | `target_hours_per_week` は `selection` の値で必ず入る（null にならない）。`frequency` は利用者が回数を言った場合に「週N回」の文字列で保存するが、**配置には使わない**（参考情報） |

### 8.2 目標タスクと今週の目標分

**目標タスク**：カテゴリごとのテンプレートで作る（**補正 C-11**）。

| カテゴリ | メイン（時間・集中力・分割・中断・バッファ適性） | 軽作業版 |
|---|---|---|
| 資格・テスト勉強 | 60分・medium・○・○・low | 30分・low・○・○・high |
| 筋トレ・運動 | 45分・low・×・×・low | なし |
| 大学の課題・レポート | 60分・high・○・×・low | なし |
| 就活 | 60分・medium・○・○・low | 30分・low・○・○・high |
| その他 | 60分・medium・○・○・medium | なし |

- 名前：LLM（`GoalTaskNamesLlmSchema`、入力は task_name・category・conditions）。20文字以内でなければテンプレート「{task_name} 演習」「{task_name} 単語・復習」。デモの LLM 出力の例：「TOEIC リスニング演習」「TOEIC 単語」
- `importance` は目標の `priority`、`deadline_at` は null、`status` は `not_started`
- `remaining_minutes`（DB）には `target_hours_per_week × 60` を入れる。**API と Engine は DB の値を使わず、次の値を使う**

**今週の目標分と残り**（`lib/server/planning-context.ts` で計算し、`PlanningContext` に入れる）：

```text
今週の目標分 W = target_hours_per_week × 60                         … 目標の created_at が今週の月曜より前
               = 15分単位に丸め(target_hours_per_week × 60 × 残り日数 ÷ 7) … 目標を今週作った場合（残り日数 = 今日〜日曜）
実施済み D = task_done_logs のうち今週（week_start〜）のその目標のタスクの分
           ＋ 有効な計画のうち、その目標のタスク項目で carried = false かつ end_at ≤ now の分（補正 C-5）
残り R = max(0, W − D)
```

残り日数は、目標を作った日（created_at の日付、JST）から日曜までの日数とする（計算する日ではない。W は作った週の間は変わらない）

- 目標の `created_at` は、confirm のときの `getNow()`（デモ時刻）を入れる
- 時間帯の希望：slots の `weekday_time_band`・`weekend_time_band` を `goals` の同名の列に保存し、PlanningContext の `goal_time_bands` で Engine に渡す（**補正 C-21**。`GoalSchema` は変えない）
- **実施済みの記録**：完了の操作（ボタン）は作らず、「終了時刻を過ぎた計画のタスクは実施済み」とみなす。計画を選び直すと前の計画は discarded になるため、`select_plan` が切り替えの前に、前の計画の実施済みの分を `task_done_logs` に写す。作り直した案に写した過去の項目（`carried = true`）は数えない（二重計上を防ぐ）

- 週の途中で目標を作っても、無理な量を残りの日に詰め込まない（日割り。**補正 C-15**）。デモは月曜7:00なので W = 360
- `GET /api/tasks` の目標タスクの `remaining_minutes` は R（同じ目標のタスクで共有）

### 8.3 PlanningContext の組み立て（`lib/server/planning-context.ts`）

| 項目 | 取り方 |
|---|---|
| now | `getNow(userId)` |
| week_start | `getWeekStart(toDateStr(now))` |
| style | 生成：null。再計画：有効な計画の style |
| preferences / home_location_id | `user_settings` |
| locations / travel_times | 全件 |
| fixed_events | 今週に展開したもの（9.1.2）＋（再計画の new_fixed_event のとき）追加する予定 |
| goals | `status = active`（0件か1件） |
| goal_time_bands | 有効な目標の `weekday_time_band`・`weekend_time_band` |
| goal_week_target_minutes / goal_done_minutes | 8.2 |
| tasks | `status != completed` の全件。締切タスク・任意タスク・軽作業の `remaining_minutes` は「DB の値 − そのタスクの実施済み（`task_done_logs` の全期間＋有効な計画の carried = false かつ end_at ≤ now の分）」（0未満は0）。目標タスクは 8.2 の R |
| checkin | 今日の `daily_checkins`（なければ null） |
| locked_items | 有効な計画が今週のものなら、その項目のうち `end_at ≤ now` のもの（生成時。作り直しても実施済みを消さないため）。再計画時は 12.2 |

`tasks` で残りが0になったタスクは、Engine に渡さない。

### 8.4 受け入れテスト

- [ ] confirm 後、`goals` に1件（active）、TOEIC の目標タスクが2件でき、`GET /api/tasks` に出る
- [ ] もう一度ヒアリングして confirm すると、前の目標は archived、前の目標タスクは消え、新しい目標タスクだけが残る
- [ ] 木曜 12:00 に作った週6時間の目標は、W = round15(360 × 4 ÷ 7) = 210
- [ ] `PlanningContext` に会話の文章が含まれない

## 9. 入力データ：固定予定・場所・移動・タスク・チェックイン（F-05・F-06・F-07）優先度A

### 9.1 固定予定・場所・移動時間（F-05）

#### 9.1.1 機能要件

| ID | 要件 |
|---|---|
| FR-05-1 | 固定予定・場所・移動時間表は seed で用意する。**登録・編集の画面と API は作らない**（要件定義 4.3 の注記どおり） |
| FR-05-2 | `/settings` で場所・移動時間表・生活リズムを閲覧できる（モックのまま） |
| FR-05-3 | Planning Engine は固定予定を変更しない |
| FR-05-4 | 場所が異なる予定の間に移動を入れる（10.4） |
| FR-05-5 | 移動時間表にない組み合わせが必要になったら、計画は作らず 422（「移動時間表に『{A}→{B}』を登録してください」） |

#### 9.1.2 繰り返しの展開（`expandFixedEvents(events, fromDate, toDate)`。`lib/planning/skeleton.ts` に置き、calendar からも使う）

- `recurrence: "weekly"`：`start_at` の曜日・時刻を、範囲内の**すべての週**に展開する（開始日より前の週にも出す。MVP では繰り返しの開始日・終了日を持たないため。モックと同じ）
- `recurrence: null`：その日時だけ
- **PlanningContext（1週間分）では、展開した予定の `id` は元の id のまま**にする（毎週の予定は1週間に1回しか出ないので重複しない）。項目の `fixed_event_id` も元の id
- カレンダー（複数週）で返す項目の `id` は `{元のid}_{YYYY-MM-DD}`（元の日付の回は元の id。モックと同じ）

#### 9.1.3 場所の決め方

- 睡眠：`home_location_id`
- 固定予定の `location_id` が null：直前の場所にいるとみなす（その前後で移動を入れない）
- タスク・バッファ・自由時間：その空きの場所（10.5）
- 移動の項目：`location_id` は null、`travel` に出発地・到着地・手段

### 9.2 タスク管理（F-06）

| ID | 要件 |
|---|---|
| FR-06-1 | `GET /api/tasks`：自分のタスク（`status != completed`）。`remaining_minutes` は 8.3 と同じ計算値 |
| FR-06-2 | `POST /api/tasks`（`TaskCreateRequestSchema`）→ `{ task }`。`PATCH /api/tasks/{id}`（`TaskUpdateRequestSchema`）→ `{ task }`。`DELETE /api/tasks/{id}` → `{ ok: true }` |
| FR-06-3 | 目標タスクは POST・PATCH・DELETE の対象外（400）。目標の確定でだけ作る |
| FR-06-4 | タスクを変えても、有効な計画は自動では作り直さない（反映は再計画か作り直し） |
| FR-06-5 | 計画に使われているタスクを削除しても計画の項目は残る（`task_id` が null になり、タイトルはそのまま表示される） |
| FR-06-6 | **画面は作らない**（Demo Path に不要。時間が余った場合の作業として 17.3 に置く） |

入力の検証：`estimated_minutes` は5〜600の5の倍数、`remaining_minutes` は0〜6000の5の倍数、`deadline_at` は `now` より後。

### 9.3 デイリーチェックイン（F-07）

| ID | 要件 |
|---|---|
| FR-07-1 | `POST /api/checkin`（`CheckinRequestSchema`）→ `CheckinResponseSchema`。同じ日は上書き |
| FR-07-2 | `GET /api/checkin?date=` → `CheckinResponseSchema`（なければ `checkin: null`） |
| FR-07-3 | `text` がある場合の抽出は MVP では行わず、`note` に保存するだけにする（選択式の値だけを計画に使う） |
| FR-07-4 | チェックインは、その日の計画の生成（P4の Fit・9.1 の適応）と再計画の入力になる |
| FR-07-5 | **画面は作らない**（mock-spec 10.10 の決定を維持）。再計画の `state_change` で、その日の `fatigue` を保存する（12.2） |
