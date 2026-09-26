# 担当A（AI / Backend / DB）の作業一覧と進み具合

> 設計書 `schedule.md`（16章）の分担・順番を起点に、担当A の作業を「終わったこと」「残っていること」「他の担当を待つもの」に分けたもの。
> 章番号（例：1.3）は設計書の章を指す。実装の書き方は `supabase-setup-guide.md` を見る。
>
> 最終更新：2026-09-26（B の Planning Engine は、この時点でまだ着手されていない）

## 目次

1. [担当A の範囲（16.1）](#1-担当a-の範囲161)
2. [全体の進み具合（16.2 の段階ごと）](#2-全体の進み具合162-の段階ごと)
3. [終わったこと](#3-終わったこと)
4. [残っていること：他の担当を待たずにできる](#4-残っていること他の担当を待たずにできる)
5. [残っていること：B（Planning Engine）を待つ](#5-残っていることbplanning-engineを待つ)
6. [C（Frontend）との関係](#6-cfrontendとの関係)
7. [おすすめの順番](#7-おすすめの順番)
8. [チームで相談すること](#8-チームで相談すること)
9. [一時的な例外と既知のリスク](#9-一時的な例外と既知のリスク)
10. [Claude Code への頼み方](#10-claude-code-への頼み方)

---

## 1. 担当A の範囲（16.1）

| 設計書の範囲 | 中身 |
|---|---|
| 1.3〜1.4、1.8 | 時刻とデモモード、LLM モード、AGENTS.md の変更 |
| 2章 | API 共通仕様（エラーの形、`handle()`、LLM 呼び出し `callStructured()`） |
| 3章 | スキーマの追加（`lib/schemas.ts` に反映済み） |
| 4章 | DB（migration、RLS、SQL 関数、seed） |
| 5〜9章 | 認証、ヒアリング、目標時間3案（文章）、Goal Handoff、入力データ（固定予定・タスク・チェックイン） |
| 11章（API） | 3案の保存・選択、カレンダー |
| 12.1〜12.3・12.6 | 再計画の API、意図の取り出し、accept |
| 14.3 | モックへの先行追加（`/api/clock` など） |

主なファイル：`lib/server/*`、`lib/llm/*`、`supabase/*`、`app/api/**`、`proxy.ts`、`.env.example`、`AGENTS.md`

**A と B の境界**（16.1）：A は `PlanningContext` を作って B の関数を呼ぶだけ。配置・理由の文章には手を入れない。

---

## 2. 全体の進み具合（16.2 の段階ごと）

| 段階 | A の作業（16.2） | 状況 |
|---|---|---|
| 1 | migration の実行、14.3 の `/api/clock`、パッケージ追加 | ✅ 完了 |
| 2 | `supabase.ts`・`auth.ts`・`clock.ts`・`http.ts`、ログイン・seed・リセット、`/api/clock` | ✅ 完了 |
| 3 | calendar・settings・tasks の本番化（11.3・9章）、`planning-context.ts` | 🟡 settings・tasks・checkin は完了。**calendar と `planning-context.ts` が残り** |
| 4 | ヒアリング（`off` → `on`）、3案（7章）、confirm（8章）、plans API（11.1） | ⬜ 未着手 |
| 5 | replan・accept API（12.2・12.3・12.6） | ⬜ 未着手 |
| 6 | 全員：16.3 の通し確認 | ⬜ |

B の段階（16.2）は、1（`skeleton`・`slots`）から未着手。A の段階3の残りと段階4・5は、B の成果物を使う部分がある（5章）。

---

## 3. 終わったこと

| 作業 | 設計書 | 備考 |
|---|---|---|
| Supabase のプロジェクト作成、`0001_init.sql`・`0002_functions.sql` の実行（13表・RLS・4関数） | 4.1〜4.4 | |
| パッケージ追加：`@supabase/supabase-js`、`@supabase/ssr`、`vitest`（`@types/node` は ^24） | 1.7 | `vitest.config.mts` と CI は B の担当 |
| `lib/server/supabase.ts`・`supabase-admin.ts` | 1.2 | |
| `lib/server/http.ts`（`HttpError`・`handle()`・`parseBody()` など） | 2.1・2.2 | |
| `lib/server/auth.ts`（`requireUser()`） | 5.2 | |
| `lib/server/clock.ts`（`isDemoMode()`・`getNow(userId, supabase?)`・`DEFAULT_DEMO_NOW`・`requireDemoMode()`・`setDemoNow()`） | 1.3 | `getNow` の2つ目の引数は設計書にない追加 |
| `lib/datetime.ts` に `toJstIso()` | 2.1 | |
| `lib/server/seed.ts`（`seedDemoUser()`・`resetDemoUser()`） | 4.5 | `user_settings` を最後に入れる（設計書との違い） |
| `POST /api/auth/mock-login`（Supabase Auth。デモ用アカウントの自動作成） | 4.5・5.2 | |
| `proxy.ts`（未ログインで画面を開くと `/login`） | 5.2 | |
| `app/page.tsx`（`/` のリダイレクト） | 5.2（C-3） | |
| `POST /api/auth/logout` | FR-01-5 | ボタンは作らない |
| `GET /api/clock` | 1.3 | |
| `GET・POST /api/mock/clock`（`demo_now` の読み書き） | 1.3 | 一時的な例外あり（9章） |
| `POST /api/mock/reset` | 4.5 | 一時的な例外あり（9章） |
| `GET /api/settings` | 9.1・3.2 | |
| `GET /api/tasks`（`lib/server/task-progress.ts` の `loadTaskProgress()`） | 9.2・8.2・8.3 | W の残り日数は「目標を作った日から日曜まで」（backend.md 8.2 に追記） |
| `POST /api/tasks`・`PATCH`・`DELETE /api/tasks/{id}` | 9.2 | PATCH の残り時間は「入力値 ＋ 実施済み」を保存（backend.md 9.2 に追記） |
| `POST・GET /api/checkin` | 9.3 | 部分更新（backend.md 9.3 に追記）。`upsertCheckin()` は 12.2 でも使う |

### 受け入れテスト 5.3（認証）

- [x] 未ログインで `/today` を開くと `/login` に移る
- [x] 未ログインで `GET /api/tasks` が 401
- [x] 別の利用者のタスク ID で `PATCH /api/tasks/{id}` を呼ぶと 404（存在しない UUID で確認）
- [x] 新しい Supabase プロジェクトで初めてログインボタンを押すと、デモ用アカウントが作られ、seed が入り、`/interview` に進む
- [x] 2回目のログインでは seed が重複しない

---

## 4. 残っていること：他の担当を待たずにできる

| 作業 | 設計書 | 段階 | 中身 |
|---|---|---|---|
| **環境変数の名前をそろえる** | README 15.3 | — | 設計書は `NEXT_PUBLIC_SUPABASE_ANON_KEY`・`SUPABASE_SERVICE_ROLE_KEY`、コードは `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`・`SUPABASE_SECRET_KEY`。設計書 15.3 の表を直し、B・C に伝える（済んでいなければ） |
| ヒアリング `interview/start`・`message`（ステップ1〜4、`LLM_MODE=off` の台本） | 6.2.1〜6.2.4・6.2.6 | 4 | 状態遷移、400・409 の判定、発言の保存 |
| ヒアリングの要約（ステップ8）・最終確認（ステップ9） | 6.2.5 | 4 | テンプレートで作る |
| `interview/confirm`（目標・目標タスクの保存。`confirm_goal` を rpc） | 8.1・8.2 | 4 | 目標タスクはカテゴリ別テンプレート（8.2）。**スケジュールは作らない** |
| 3案の文章（テンプレート版） | 7.2.3 | 4 | `LLM_MODE=off` の文章。数値は B（5章） |
| `lib/llm/client.ts`（`callStructured()`） | 2.4 | 4 | OpenAI を `fetch` で呼ぶ。SDK は入れない |
| ヒアリングの `LLM_MODE=on`（`lib/llm/interview.ts`） | 6.2.3 | 4 | 失敗は 502、状態も発言も保存しない |
| 3案の文章・目標タスクの名前の `LLM_MODE=on` | 7.2.3・8.2 | 4 | 失敗時はテンプレート |
| 再計画の意図の取り出し：キーワード（`lib/llm/replan-keywords.ts`） | 12.3.2 | 5 | `LLM_MODE=off` と失敗時 |
| 再計画の意図の取り出し：LLM（`lib/llm/replan-intent.ts`） | 12.3.1 | 5 | |
| `plans/replan/accept`（`apply_replan` を rpc） | 12.6 | 5 | API 自体は B を待たない。ただし確かめるには replan の提案が要る（5章） |
| Vercel へのデプロイ | README 15.3 | 6 | 環境変数（`DEMO_MODE=1`・`LLM_MODE=on`）、Node.js 24、Supabase の Site URL |

---

## 5. 残っていること：B（Planning Engine）を待つ

| A の作業 | 設計書 | 使う B の成果物 | B の段階（16.2） | B がないときにできること |
|---|---|---|---|---|
| ヒアリングのステップ5〜6（目標時間3案の数値） | 7.2・6.2.6 | `lib/planning/goal-candidates.ts`（`computeGoalCandidateHours()`）と、`slots.ts` の `computeWeeklyFreeMinutes()`（7.2.2 の上限に今週の空きの合計が要る） | **4**（B の作業手順では手順2・4、★1＋★3） | ステップ4までを先に作り、差し込む場所だけ用意しておく |
| カレンダー `calendar/day・week・month`（`lib/server/calendar.ts`） | 11.3・9.1.2 | `lib/planning/skeleton.ts` の `expandFixedEvents()` | **1** | 待つ。また、DB に計画がない間に本番化すると `/today` が固定予定だけになるので、plans API の後がよい |
| `lib/server/planning-context.ts` | 8.3 | `expandFixedEvents()`（fixed_events を今週に展開） | **1** | 展開以外（タスクの残り＝`loadTaskProgress()`、目標、チェックイン、locked_items）は先に作れる |
| `plans/generate`・`candidates`・`{id}/select` | 11.1 | `lib/planning/generate.ts` の `generatePlans(context)` | **3**（その前に 2 の `priority`・`fit`・`allocate`・`day-beam` が要る） | `candidates` と `select` は B を待たずに作れる。generate だけ待つ |
| `plans/replan` | 12.2 | `lib/planning/replan.ts` の `replan()`、`diff.ts`、`reasons.ts` | **5**（`reasons` は 3） | 意図の取り出し（12.3）と、Before・PlanningContext の組み立てまでは先に作れる |
| `GET /api/mock/check` | 1.3 | `lib/planning/validate.ts` の `validatePlan()` | **3** | 待つ |

**B の段階の中身**（16.2）：1＝`skeleton`・`slots`、2＝`priority`・`fit`・`allocate`・`day-beam`、3＝`objectives`・`select`・`generate`・`validate`・`summarize`・`reasons`、4＝`goal-candidates`、5＝`replan`・`diff`

---

## 6. C（Frontend）との関係

A の作業が C を待つことはない。逆に、C の作業には A の API が必要なものがある。

| C の作業（14章） | A との関係 |
|---|---|
| `lib/api.ts` の `fetchClock()`、各画面を `/api/clock` に切り替え（14.1・14.2） | `GET /api/clock` は完了。**C はすぐ進められる**ことを伝える |
| 401 なら `/login` に移す（14.1） | A の API は 401 を返すようになっている |
| `/today` の「目的地を相談する」（14.2） | calendar の本番化（`has_plan: false`）で確かめられる |
| `/interview` の「スケジュール作成」の失敗表示（14.2） | `plans/generate` の 422 で確かめられる |
| `REPLAN_QUICK_REPLIES` を「20時から1時間予定が入った」などに変更（14.2） | 今の画面は「18時から予定が入った」のまま。C に伝える |

---

## 7. おすすめの順番

B が未着手のため、B を待たない作業を先に進める。

| 順 | 作業 | 理由 |
|---|---|---|
| 1 | 環境変数の名前をそろえる | B・C が `.env.local` を作る前に |
| 2 | ヒアリング（ステップ1〜4、台本） | Demo Path の入口。B を待たない |
| 3 | ヒアリングのステップ8〜9、`interview/confirm` | 目標・目標タスクが DB に入り、`/settings` の目標や tasks の目標タスクの計算も確かめられる |
| 4 | `plans/candidates`・`plans/{id}/select`、`planning-context.ts`（展開以外） | generate の準備 |
| 5 | 再計画の意図の取り出し（キーワード） | B を待たない |
| 6 | `lib/llm/client.ts` と各 LLM（`on`） | `off` で Demo Path が通ることが優先（16.2） |
| 7 | B の成果物ができ次第：ステップ5〜6 → generate → calendar → replan → mock/check | |
| 8 | Vercel、通し確認（16.3） | |

---

## 8. チームで相談すること

- **B の遅れ**：設計書は「Planning Engine を先に仕上げることを優先する」（16.2）としている。3案の生成がないと Demo Path の ⑤ 以降が通らない
- **A が B の小さな関数を引き受ける案**（B の了承が必要。ファイルは B の担当範囲）

| 関数 | 設計書 | 大きさ |
|---|---|---|
| `lib/planning/goal-candidates.ts`（目標時間3案の数値） | 7.2・7.3 | 小さい。式とテスト7件が設計書にある |
| `lib/planning/skeleton.ts` の `expandFixedEvents()` | 9.1.2 | 小さい |

引き受ければ、B は本体（`generate`）に集中でき、A はヒアリングのステップ5〜6と calendar を待たずに進められる。

---

## 9. 一時的な例外と既知のリスク

### 一時的な例外（全 API の本番化後に消す。コードに `TODO` コメントあり）

- `POST /api/mock/reset` が `resetState()`（モックのストア）も呼ぶ
- `POST /api/mock/clock` がモックの時刻も同じ値にする
- `POST /api/plans/replan` の中の18:00への繰り上げ（`advanceToEighteenIfBefore()`）は、replan を本番化するときに削除する。繰り上げは `/replan` の画面が `POST /api/mock/clock` で行い、API は `getNow()` をそのまま使う
- 本番化した API のモックのファイル（`lib/mock/*`）は、すべて差し替えたら削除する（1.6）

### 既知のリスク

- **ID の食い違い**：場所・タスクの ID は DB では UUID、calendar・plans はまだモックの ID（`loc_home`・`task_report` など）を返す。そのため `/today`・`/calendar` で場所の名前・締切バッジ・バッファの候補タスク名が出ない。calendar と plans の本番化で直る
- **目標が null**：confirm を本番化するまで、`/settings` と `/plans` の目標は常に「なし」
- **reset はトランザクションでない**：途中で失敗したら、もう一度 reset すれば直る
- **PATCH と実施済みの記録**：`task_done_logs.minutes` が5の倍数でないと、PATCH で保存する値が DB の制約に引っかかる（計画の項目は5分単位なので起きない想定）
- **Supabase 無料プランの一時停止**：発表の前日と当日の朝にログインして確かめる。止まっていたらダッシュボードで Restore

---

## 10. Claude Code への頼み方

毎回、新しいブランチ（`git switch main` → `git pull` → `npm install` → `git switch -c feature/<作業名>`）を作ってから、次の形で頼む。

```text
docs/design/ の README.md・common.md と、<作業の章があるファイル> を読んでから作業してください。
docs/design/supabase-setup-guide.md と docs/design/backend-a-roadmap.md に、これまでの作業と決まりがあります。

## 今回の作業
<作業名>（<設計書の章>）
<注意点があれば箇条書き>

## ルール
- 最初に計画を見せてから実装する
- git の commit・push はしない（自分で行う）。変更したファイルの一覧とコミットメッセージの案を最後に出す
- パッケージを追加しない。スキーマ（lib/schemas.ts）・API の形・DB の列を変えるときは先に相談する
- handle()・requireUser()・getNow() を使う。「今」の時刻に new Date() を直接使わない
- 設計書と違うところがあれば、最後の報告に「設計書との違い」として書く
- 終わったら npx tsc --noEmit と npm run lint を実行し、結果を報告する
- ブラウザでの動作確認の手順（何を開き、何が表示されればよいか）を最後に書く
```

### 例：ヒアリング（ステップ1〜4）

```text
## 今回の作業
POST /api/interview/start・POST /api/interview/message を本番化する。まず LLM_MODE=off（台本）だけ（backend.md 6章、特に 6.2.4・6.2.6、common.md 1.4）
- 状態・ステップ・slots・発言は interview_sessions・interview_messages に保存する
- start：新しいセッションを作り、進行中の古いセッション（INTERVIEWING・CONFIRMING）は ABANDONED にする
- message：ステップに合わない送り方は 400、不正な状態遷移は 409 INVALID_STATE（6.2.4 の表）
- 台本の発言・クイックリプライは mocks/interview-script.ts のものを使う。slots は G1（mocks/goal.ts）の値で埋める
- ステップ5〜6 の目標時間3案の数値は、lib/planning/goal-candidates.ts（担当B）を使う予定。まだないので、今回はステップ4の回答までを作り、ステップ5以降はどう差し込むかを計画に書く
- LLM_MODE=on の部分（lib/llm/）は今回は作らない
```
