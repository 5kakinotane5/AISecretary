# 設計書：共通（1〜3章）

> 設計書（`docs/design/`）の一部。目次・章とファイルの対応は [README.md](README.md)。章番号は設計書全体で共通。

## 1. 本番化の全体方針

### 1.1 モックから本番への差し替え方針

| 項目 | 方針 |
|---|---|
| APIのパス・レスポンスの形 | **モックと同じ**。変更・追加は3章に書いたものだけ |
| 画面 | 変更は14章に書いたものだけ |
| データの置き場所 | `lib/mock/store.ts`（メモリ）→ Supabase。`mocks/` のデータは **seed** として DB に入れる |
| スケジュール3案・再計画 | `mocks/plans/`・`mocks/replan-tired.ts` の固定データ → Planning Engine の計算結果 |
| ヒアリング・意図抽出 | 台本 → OpenAI（`LLM_MODE=on`）。`off` のときは台本・キーワードで動く（1.4） |
| モック専用API | `/api/mock/*` はデモモードでだけ有効（1.3） |

モックの固定データ（mock-spec 5.9 の3案、5.10 の再計画）は、Planning Engine の**参考出力**である。本番では同じ時刻に同じ項目が並ぶことは求めない。求めるのは各機能の受け入れテストを満たすことである。

### 1.2 ディレクトリ構成（追加分）

```text
lib/
  server/                    # サーバー側でだけ使う（画面・components から import しない）
    supabase.ts              # createClient()：Cookie 付きの Supabase クライアント（@supabase/ssr）
    supabase-admin.ts        # createAdminClient()：サービスロール。デモ用アカウントの作成（auth.admin.createUser）だけで使う
    auth.ts                  # requireUser()：ログイン中の user_id を返す。未ログインは HttpError(401)
    clock.ts                 # getNow(userId)・isDemoMode()（1.3）
    http.ts                  # handle()・HttpError：Route Handler の共通ラッパーとエラー（2.2）
    seed.ts                  # seedDemoUser(userId)（4.5。mocks/ を読む）
    interview-script.ts      # LLM_MODE=off のヒアリング（1.4。mocks/ を読む）
    planning-context.ts      # PlanningContext の組み立て（8.3）
    calendar.ts              # 日・週・月の組み立て（11.3）
    repositories/            # テーブルごとの読み書き（DB の行 ⇔ スキーマの変換もここ）
  llm/
    client.ts                # callStructured()：OpenAI 呼び出し（2.4）
    interview.ts             # F-02 抽出＋質問文
    goal-candidates.ts       # F-03 3案の文章
    goal-task-names.ts       # F-04 目標タスクの名前
    replan-intent.ts         # F-12 意図抽出
    replan-keywords.ts       # F-12 キーワードによる意図抽出（LLM_MODE=off と失敗時）
  planning/                  # Planning Engine（純粋関数のみ。DB・LLM・時計・環境変数に触れない）
    config.ts                # 係数・閾値（P12、12.4）
    skeleton.ts              # 睡眠・固定予定・移動（10.4）
    slots.ts                 # 空き（10.5）
    priority.ts              # 優先度（10.6）
    fit.ts                   # 適合度（P4）
    allocate.ts              # 週の割り振り案（P3）
    day-beam.ts              # 日ごとのビーム探索（P5）
    objectives.ts            # 目的ベクトル F(S)（P6）
    select.ts                # Pareto・3方向への選択・多様性（P7〜P8）
    generate.ts              # generatePlans(context)（10.2・P11）
    validate.ts              # validatePlan(...)（10.11）
    summarize.ts             # 集計・評価（10.12）
    recover.ts               # 成立しない場合（10.13）
    replan.ts                # replan(context, before, intent)（12.4）
    diff.ts                  # 変更点（12.5）
    reasons.ts               # 理由コード → 文章（13章）
    goal-candidates.ts       # 目標時間3案の数値（7.2）
    __tests__/               # vitest（1.7）
      fixtures.ts            # mocks/ から PlanningContext を作る
supabase/
  migrations/
    0001_init.sql            # テーブル・RLS（4.2〜4.3）
    0002_functions.sql       # トランザクション用の関数（4.4）
proxy.ts                     # 未ログインのリダイレクト（5.2。Next.js 16 では middleware ではなく proxy）
vitest.config.mts            # 1.7
```

### 1.3 現在時刻とデモモード

デモのシナリオは 2026-10-05（月）〜10-11（日）の週で組まれているが、発表日はこの週より前である。そのため、現在時刻は**サーバーで1か所から取得し、デモモードでは差し替えられる**ようにする。

| 項目 | 内容 |
|---|---|
| 環境変数 | `DEMO_MODE=1` のときデモモード。発表・開発は常にデモモードで行う |
| `isDemoMode()` | `process.env.DEMO_MODE === "1"` |
| `getNow(userId)` | デモモード：`user_settings.demo_now`。null なら `2026-10-05T07:00:00+09:00`。通常：`nowIsoJst()`（`lib/datetime.ts`） |
| ★`GET /api/clock` | **常に有効**（要ログイン）。`{ now, demo_mode }` を返す。画面が「今」を知る唯一の口 |
| `GET /api/mock/clock` | デモモードのみ。`{ now }`（互換のため残す。画面からは使わない） |
| `POST /api/mock/clock` | デモモードのみ。モックと同じ動き（`now` 指定でその時刻、省略で18:00に繰り上げ）。`user_settings.demo_now` を書く |
| `POST /api/mock/reset` | デモモードのみ。ログイン中の利用者のデータを全部消して seed を入れ直す（4.5） |
| `GET /api/mock/check` | デモモードのみ。有効な計画と最新の3案に Validator をかけた結果（形は `MockCheckResultSchema`） |
| `x-mock-error: 1` ヘッダー | デモモードのみ有効。付いていれば500を返す（画面の `?mock_error=1` の確認用。モックと同じ） |
| デモモードでない場合 | `/api/mock/*` は404。`x-mock-error` は無視 |

画面側の使い分け（14章）：

- 「今」が必要な画面（`/today`・`/calendar`・`/replan`・`/settings`）は `GET /api/clock` を呼ぶ
- `demo_mode: true` のときだけ、デモ時刻のチップ・`/replan` の18:00への繰り上げ・`/settings` のデモ用の欄を出す

### 1.4 LLM モード

| `LLM_MODE` | ヒアリング（F-02） | 3案の文章（F-03） | 目標タスクの名前（F-04） | 再計画の意図（F-12） |
|---|---|---|---|---|
| `on` | LLM（6.2.3） | LLM（7.2.3） | LLM（8.2） | LLM（12.3）。失敗時はキーワード |
| `off` | 台本（モックと同じ動き。6.2.6） | テンプレート | テンプレート | キーワード（12.3.2） |

- `OPENAI_API_KEY` が空なら、`LLM_MODE` の値にかかわらず `off` として動く
- `off` は、LLM の実装が遅れたときと、発表中に OpenAI が不調なときの**退避用**。Demo Path は `off` でも最後まで通ること（受け入れテスト 16.3）

### 1.5 用語

| 用語 | 意味 |
|---|---|
| 今週 | `now` を含む週の月曜0:00〜日曜24:00（JST） |
| 計画対象時間 | 今週のうち、`now`（5分単位に切り上げ）以降 |
| 骨組み | 睡眠・固定予定・移動だけを並べた1日 |
| 空き | 骨組みの隙間。タスク・バッファ・自由時間を置ける |
| 目標タスク | `goal_id` を持つタスク（締切なし） |
| 締切タスク | `deadline_at` を持つタスク |
| 任意タスク | 目標にも締切にも紐づかず、軽作業でもないタスク（例：企業研究） |
| 軽作業 | 目標に紐づかず、`buffer_fit: "high"` かつ `estimated_minutes ≤ 30` のタスク（例：メール返信、資料整理） |
| 高集中タスク | `concentration: "high"`、または目標タスクで `concentration: "medium"` 以上のもの |
| 有効な計画 | `weekly_plans.status = 'active'` の案（利用者ごとに最大1件） |
| 実施済み | 「実施済みの記録（`task_done_logs`）」＋「有効な計画のタスク項目のうち、引き継ぎでない（`carried = false`）もので `end_at ≤ now` のもの」（補正 C-5。8.2） |

### 1.6 モックのファイルの扱い

| ファイル | 本番での扱い |
|---|---|
| `mocks/*` | **残す**。seed（4.5）・台本（1.4）・Engine のテスト（1.7）の元データ |
| `lib/mock/store.ts`・`clock.ts`・`plans.ts`・`calendar.ts`・`summarize.ts`・`validate.ts`・`http.ts` | 対応する Route Handler を本番に差し替えたら**削除する**（同じ責務のコードを2つ持たない）。`validate.ts` と `summarize.ts` の中身は `lib/planning/` に移す |
| `app/api/**/route.ts` | 同じパスのまま中身を差し替える |
| `lib/api.ts` | 14.1 の変更だけ |

差し替えは API 単位で行ってよい（例：calendar だけ先に本番化）。ただし、1つの API の中でモックの状態（メモリ）と DB を混ぜて使わない。

### 1.7 パッケージ・スクリプト・テスト

追加するパッケージ（AGENTS.md のルールに従い、PR の説明に下の理由を書く）：

| パッケージ | 種類 | 理由 |
|---|---|---|
| `@supabase/supabase-js` | dependencies | DB・認証 |
| `@supabase/ssr` | dependencies | Cookie によるセッション管理（Route Handler・proxy） |
| `vitest` | devDependencies | Planning Engine の単体テスト |

追加しないもの：OpenAI の SDK（`fetch` で呼ぶ。2.4）、`tsx` 等（seed は API の中で実行する。4.5）、日付ライブラリ（`lib/datetime.ts` を使う）。

`package.json` の scripts に追加：

```json
"test": "vitest run"
```

`vitest.config.mts`：

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { environment: "node", include: ["lib/**/__tests__/**/*.test.ts"] },
});
```

CI（`.github/workflows/ci.yml`）の最後に `- run: npm test` を追加する。テストは DB・LLM・ネットワークを使わない（Engine の純粋関数だけを対象にする）。

### 1.8 AGENTS.md の変更

「モックとの関係」の3つ目の項目を次に置き換える。

> - 画面（`app/` の page や `components/`）は `mocks/` を直接 import しない。データは必ず `lib/api.ts` 経由でAPIから受け取る。`mocks/` を import してよいのは `app/api/`、`lib/mock/`、`lib/server/seed.ts`、`lib/server/interview-script.ts`、`lib/planning/__tests__/` だけ

「作業の終わりに」に `npm test`（Planning Engine を変更した場合）を追加する。

## 2. API共通仕様

### 2.1 共通ルール

- すべてのAPIは Route Handler（`app/api/**/route.ts`）で実装し、`lib/server/http.ts` の `handle()` で包む
- リクエストは Zod で検証し、失敗したら400
- レスポンスは返す前に必ずスキーマの `.parse()` を通す（Zod の `z.object` は定義にないキーを取り除くので、内部の項目（`reason_code` など）は `.parse()` で自然に落ちる）
- `user_id` はリクエストから受け取らない。`requireUser()` の戻り値だけを使う
- DB は利用者のセッション付きクライアントで読み書きし、RLS に守らせる。サービスロールは `lib/server/supabase-admin.ts` 経由で、デモ用アカウントの作成だけに使う（seed は利用者のセッション付きクライアントで入れる。4.5）
- **タイムゾーン**：サーバー（Vercel）は UTC で動く。`Date` の `getHours()` などのローカル時刻のメソッドは使わない。日時の計算・表示はすべて `lib/datetime.ts` の関数で行う（必要な関数はそこに追加する）
- DB の `timestamptz` は UTC で返ってくるので、`repositories/` で `+09:00` 付きの ISO 8601 に変換してから使う（`toJstIso()` を `lib/datetime.ts` に追加）
- API の待ち時間（モックの `delay`）は入れない
- `x-mock-error: 1` ヘッダーの処理は `handle()` の先頭で行う（デモモードなら500を返す。デモモードでなければ無視）。`lib/mock/http.ts` を消したあとは、ここだけが担う

### 2.2 エラー応答

**補正 C-1**：エラー応答の形を統一する。

```json
{ "error": { "code": "INVALID_STATE", "message": "スケジュール作成は目標の確定後に行えます" } }
```

| HTTP | code | 使う場面 |
|---|---|---|
| 400 | `INVALID_REQUEST` | リクエストがスキーマに合わない・ステップに合わない送り方 |
| 401 | `UNAUTHORIZED` | 未ログイン |
| 404 | `NOT_FOUND` | 対象がない、または他人のデータ（存在を明かさない）。デモモードでない `/api/mock/*` |
| 409 | `INVALID_STATE` | 状態として不正（例：`READY_FOR_PLANNING` 前の generate、有効な計画がないのに replan） |
| 409 | `PROPOSAL_EXPIRED` | 再計画の提案が古い |
| 422 | `INFEASIBLE` | 計画が成立しない（generate のみ。`message` に理由と必要な変更を入れる。10.13） |
| 502 | `LLM_ERROR` | LLM の応答が得られない（ヒアリングの抽出だけ。他は 1.4 の退避で続行する） |
| 500 | `INTERNAL` | その他 |

- `message` は画面にそのまま出せる日本語。スタックトレース・SQL・トークン・個人情報を含めない
- サーバー側のエラーは `HttpError(status, code, message)`（`lib/server/http.ts`。画面側の `lib/api.ts` の `ApiError` とは別物）で投げる。`handle()` は `HttpError` を上の形に変換し、それ以外の例外は500 `INTERNAL`（`message`：「エラーが発生しました。時間をおいて再試行してください」）にしてサーバーログに種類だけ出す
- 再計画が成立しない場合は 422 にせず、`{ supported: false, message }`（200）で返す（12.2。画面の変更をなくすため）

### 2.3 API一覧

★は設計書で追加するもの。「形」がモックと同じものは画面の変更が要らない。

| メソッド・パス | 機能 | 担当 | 形 |
|---|---|---|---|
| `POST /api/auth/mock-login` | F-01 | A | モックと同じ |
| ★`POST /api/auth/logout` | F-01 | A | `{ ok: true }` |
| ★`GET /api/clock` | 1.3 | A | `ClockResponseSchema` |
| `POST /api/interview/start` | F-02 | A | モックと同じ |
| `POST /api/interview/message` | F-02/03 | A | モックと同じ |
| `POST /api/interview/confirm` | F-02/04 | A | モックと同じ |
| `POST /api/plans/generate` | F-08 | A（API）/ B（Engine） | モックと同じ |
| `GET /api/plans/candidates` | F-08 | A | モックと同じ |
| `POST /api/plans/{id}/select` | F-08 | A | モックと同じ |
| `GET /api/calendar/day?date=` | F-10/11 | A | モックと同じ |
| `GET /api/calendar/week?start=` | F-11 | A | モックと同じ |
| `GET /api/calendar/month?month=` | F-11 | A | モックと同じ |
| `POST /api/plans/replan` | F-12 | A / B | モックと同じ |
| `POST /api/plans/replan/accept` | F-12 | A | モックと同じ |
| `GET /api/settings` | F-05 | A | **goal が null になりうる**（3.2） |
| `GET /api/tasks` | F-06 | A | モックと同じ |
| ★`POST /api/tasks`・`PATCH /api/tasks/{id}`・`DELETE /api/tasks/{id}` | F-06 | A | 9.2（画面なし） |
| ★`POST /api/checkin`・`GET /api/checkin?date=` | F-07 | A | 9.3（画面なし） |
| `GET/POST /api/mock/clock`・`POST /api/mock/reset`・`GET /api/mock/check` | デモ | A | モックと同じ（デモモードのみ） |

### 2.4 LLM 呼び出しの共通仕様（`lib/llm/client.ts`）

```ts
callStructured<T>(options: {
  name: string;                 // ログ用・JSON Schema の名前
  system: string;               // システムプロンプト
  user: string;                 // 入力（JSON 文字列でよい）
  schema: z.ZodType<T>;         // LLM に渡す形（制約なし。下記）
  timeoutMs: number;
  retries: 0 | 1;
  temperature: number;
}): Promise<T>                  // 失敗・タイムアウト・検証エラーは LlmError を投げる
```

| 項目 | 内容 |
|---|---|
| 呼び方 | `fetch("https://api.openai.com/v1/chat/completions")`。`response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` |
| モデル | 環境変数 `OPENAI_MODEL`（Structured Outputs に対応したモデル。コードに直書きしない） |
| JSON Schema | `z.toJSONSchema(schema)` で作り、`toStrictJsonSchema()`（`client.ts` 内）で、すべてのオブジェクトに `additionalProperties: false` と全キーの `required` を付ける |
| LLM に渡すスキーマ | **型だけ**にする（`.max()`・`.regex()`・`.min()` などの制約を付けない。strict モードで使えない指定があるため）。制約は、受け取ったあとに別の Zod スキーマ（3.3）で検証する |
| 呼び出しごとの設定 | 下表 |
| ログ | 入力・出力の文章と APIキーはログに出さない。出してよいのは name・所要時間・成否・エラー種別 |

| 用途 | timeoutMs | retries | temperature | 失敗したとき |
|---|---|---|---|---|
| ヒアリングの抽出（6.2.3） | 6000 | 1 | 0 | 502 `LLM_ERROR`（状態は進めない） |
| 3案の文章（7.2.3） | 5000 | 0 | 0.7 | テンプレート文 |
| 目標タスクの名前（8.2） | 4000 | 0 | 0.3 | テンプレート名 |
| 再計画の意図（12.3） | 5000 | 0 | 0 | キーワード（12.3.2） |

生成（`plans/generate`）では LLM を呼ばない（説明文はテンプレート。13章）。これにより要件定義 10章の「10秒以内」を守る。

## 3. データの約束（`lib/schemas.ts`）

型の正は `lib/schemas.ts`（AGENTS.md）。本番化で足したスキーマ・変えたスキーマは、すでに `lib/schemas.ts` に入っている。この章は一覧と決まりだけを書く。スキーマを変えるときは、AGENTS.md のとおり報告してから変え、この章の表も直す。

### 3.1 追加したスキーマ

| スキーマ | 使う場所 | 章 |
|---|---|---|
| `ClockResponseSchema` | `GET /api/clock`（`{ now, demo_mode }`） | 1.3 |
| `ApiErrorCodeSchema`・`ApiErrorSchema` | すべての API のエラー応答 | 2.2 |
| `OkResponseSchema` | `POST /api/auth/logout`・`DELETE /api/tasks/{id}` | 2.3 |
| `DailyCheckinSchema`・`CheckinRequestSchema`・`CheckinResponseSchema` | チェックイン | 9.3 |
| `TaskCreateRequestSchema`・`TaskUpdateRequestSchema`・`TaskResponseSchema` | タスクの登録・編集 | 9.2 |
| `TimeBandSchema`・`GoalTimeBandsSchema` | 目標の時間帯の希望 | 6.2.2・8.2・P4.1 |
| `PlanningContextSchema` | Planning Engine の入力 | 8.3 |
| `ReasonCodeSchema`・`PlannedItemSchema` | 理由コードの受け渡し | 10.2・13.2 |
| `ObjectiveVectorSchema`・`EnginePlanSchema` | Engine の出力（1案） | P6・P10.1 |
| `InfeasibleSchema`・`ValidationResultSchema` | 成立しない場合・Validator の結果 | 10.11・10.13 |
| `EngineGenerateResultSchema`・`EngineReplanResultSchema` | Engine の生成・再計画の結果 | 10.2 |

型（`z.infer`）：`ClockResponse`・`ApiErrorCode`・`DailyCheckin`・`TimeBand`・`GoalTimeBands`・`PlanningContext`・`ReasonCode`・`PlannedItem`・`ObjectiveVector`・`EnginePlan`・`Infeasible`・`ValidationResult`・`EngineGenerateResult`・`EngineReplanResult`。

決まり：

- `PlannedItemSchema` は `ScheduleItemSchema` に `reason_code` を足したもの。API が画面に返すときは `ScheduleItemSchema.parse()`（`ScheduleCandidateSchema.parse()`）を通すので、`reason_code` は自然に落ちる。DB には `reason_code` 列として保存する
- `EnginePlanSchema.features` は API では返さず、`weekly_plans.features` に保存する
- `PlanningContextSchema` の `fixed_events` は今週に展開したもので、id は元の id のまま（9.1.2）

### 3.2 既存スキーマの変更（例外として変更したもの）

| スキーマ | 変更 | 理由 |
|---|---|---|
| `SettingsResponseSchema.goal` | `GoalSchema` → `GoalSchema.nullable()` | 目標の確定前（ログイン直後・リセット直後）に返せないため。画面は対応済み（14.2） |
| `ValidationIssueCodeSchema` | `PAST_PLACEMENT`・`LOCKED_ITEM_CHANGED`・`CANDIDATES_TOO_SIMILAR` を追加 | 10.11。`CANDIDATES_TOO_SIMILAR` は warnings でだけ使う。`GOAL_HOURS_MISMATCH` は本番でも使う（コメントを直した） |

上記以外の既存スキーマ（`ScheduleItemSchema`・`ScheduleCandidateSchema`・`ReplanProposalSchema` など）は変えていない。`MockClockResponseSchema` も残す。

### 3.3 LLM 用のスキーマ

2.4 のとおり、LLM に渡すスキーマ（`*LlmSchema`）は**型だけ**にする（`.max()`・`.regex()` などの制約を付けない。strict モードで使えない指定があるため）。受け取ったあと、検証用のスキーマ（`*CheckedSchema`）で制約を確かめる。

| スキーマ | 用途 | 章 |
|---|---|---|
| `INTERVIEW_CATEGORIES` | ヒアリングのカテゴリ5つ | 6.2.2 |
| `InterviewLlmSchema`・`InterviewExtractedCheckedSchema` | ヒアリングの抽出＋次の発言。検証に通らない項目はその項目だけ null（`conditions` は通るものだけ残す）にして続行 | 6.2.3 |
| `GoalCandidateTextsLlmSchema` | 目標時間3案の文章（intensive / balanced / paced の順で3件） | 7.2.3 |
| `GoalTaskNamesLlmSchema` | 目標タスクの名前 | 8.2 |
| `ReplanIntentLlmSchema` | 再計画の意図（サーバーが `ReplanningIntentSchema` に変換する） | 12.3.1 |
