# 担当A（柿澤）：残りの作業の引き継ぎ書

> 2026-09-27 時点のチームの状況と、柿澤がこれからやることをまとめたもの。章番号（例：12.2）は設計書（`docs/design/`）の章を指す。
> main（PR #34 まで）のコードを確認して書いた。`backend-a-roadmap_2.md` は「B が未着手」のころのままなので、今の状況はこちらを正とする。

最終更新：2026-09-27

## 目次

1. [チームの状況](#1-チームの状況)
2. [終わったこと](#2-終わったこと)
3. [やること（優先順）](#3-やること優先順)
4. [待ち合わせ](#4-待ち合わせ)
5. [既知のリスクと注意](#5-既知のリスクと注意)
6. [Claude Code への頼み方](#6-claude-code-への頼み方)

---

## 1. チームの状況

### 分担（2026-09-27 に確定）

| 人 | 担当 | 今の作業 |
|---|---|---|
| 長沼 | B（Planning Engine）すべて | 再計画 `replan.ts`・`diff.ts`、再計画用の理由の文章と要約（13.4）。★6。序盤 |
| **柿澤** | **A（API・DB）** | **このファイル** |
| 石渡 | C（画面）の残り | 設計書 14章（`frontend-c-ishiwata-steps.md`） |

### Demo Path（16.3）の状況

| 段階 | 状況 |
|---|---|
| ① ログイン 〜 ⑧ `/today` に計画 | **本物の API（DB と Planning Engine）につながった** |
| ⑨「今日は疲れた」〜 ⑪ 反映 | **モックのまま**。長沼の ★6 と、柿澤の replan・accept API が要る |
| `GET /api/mock/check` | モックのまま（ダミーデータを検査している） |
| `LLM_MODE=on` | 未着手（`lib/llm/` がない） |

### 前の作業書について

石渡用・長沼用に作った B の作業書（`b-ishiwata-steps.md`・`planning-b-ishiwata-steps.md`・`planning-b-naganuma-steps.md`）は、長沼の進み具合を読み違えて作ったもの。**使わない**。長沼には連絡済み。石渡には「B の作業はやめて C に移る」ことを伝える（3章の 1）。

---

## 2. 終わったこと

| API・部品 | PR | 設計書 |
|---|---|---|
| Supabase（スキーマ・関数・RLS）、ログイン、未ログインのリダイレクト | 〜#20台 | 4章・5章 |
| tasks、checkin、clock、settings | 〜#27 | 9章・1.3 |
| ヒアリング start・message（ステップ1〜9、`LLM_MODE=off` の台本）、目標時間3案の数値 | #31・#32 | 6章・7章 |
| confirm（目標・目標タスクの保存） | #32 | 8章 |
| `planning-context.ts`、plans の generate・candidates・select | #33 | 8.3・11.1 |
| calendar の day・week・month | #34 | 11.3 |

---

## 3. やること（優先順）

| 順 | 作業 | 待つもの | 大きさ |
|---|---|---|---|
| 1 | 石渡への連絡と環境の受け渡し | なし | 今すぐ |
| 2 | `GET /api/mock/check` の本番化 | なし | 小 |
| 3 | 再計画の意図の取り出し（キーワード） | なし | 小〜中 |
| 4 | `POST /api/plans/replan`（Engine の手前まで） | なし（Engine は仮の関数） | 中 |
| 5 | `POST /api/plans/replan/accept` | なし（確かめるには 4 が要る） | 小 |
| 6 | 長沼の ★6 とつなぐ、モックの片付け | 長沼の ★6 | 中 |
| 7 | Demo Path の通し確認（`LLM_MODE=off`） | 6、石渡の手順 | 小 |
| 8 | Vercel へのデプロイ | 7 | 小 |
| 9 | `LLM_MODE=on`（余裕があれば） | 7 | 大 |

**`LLM_MODE=off` で Demo Path ①〜⑪ が通ることが最優先**（16.2）。LLM は最後。

---

### 1. 石渡への連絡と環境の受け渡し（今すぐ）

石渡は B の作業書を2回受け取って「りょうかい」と返している。reasons・select・objectives を作り始めているかもしれないので、先に止める。

- [ ] グループに分担の整理を送る（石渡：C、前の作業書は使わない、作り始めていたら push せず捨てる）
- [ ] `frontend-c-ishiwata-steps.md` を渡す
- [ ] `.env.local` を石渡に DM で送る（API が DB につながったので、ないと画面が動かない）
- [ ] collaborators の招待を承諾したか確認する（承諾しないと PR が作れない）

---

### 2. `GET /api/mock/check` の本番化

**ブランチ**：`feature/mock-check`
**設計書**：common.md 1.3（デモモードのみ。有効な計画と最新の3案に Validator をかけた結果）、10.11

今は `lib/mock/validate.ts` の `validateMockData()`（ダミーデータの検査）を返している。これを DB の計画の検査に替える。

```text
requireUser()・requireDemoMode()
PlanningContext を作る（planning-context.ts）
有効な計画（selected）の7日分 → validatePlan(ctx, days, "stored")
最新の3案 → それぞれ validatePlan(ctx, days, "stored")、まとめて validateCandidateDiversity(ctx, plans, "stored")
errors・warnings を合わせて MockCheckResultSchema.parse して返す
計画がない → errors・warnings とも空（または設計書にないので決めて PR に書く）
```

- 使う関数は main の `lib/planning/validate.ts` にある（`validatePlan`・`validateCandidateDiversity`）
- `lib/mock/validate.ts` は、この API が使わなくなったら消してよい（1.6）。ほかに使っているところがないか先に `grep` する

**完了の条件**

- [ ] リセット → ヒアリング → 3案 → バランスプランを選んだ後、`/api/mock/check` の errors が0件（16.3 の項目）
- [ ] デモモードでないと 404

---

### 3. 再計画の意図の取り出し（キーワード）

**ブランチ**：`feature/replan-intent`
**設計書**：12.3.2（キーワード）、12.3.1 の「変換・検証」、12.3.3（対応していないときの返事）

| 作るもの | 中身 |
|---|---|
| `lib/llm/replan-keywords.ts` | 発言 → `ReplanIntentLlmSchema` の形。12.3.2 の表を上から順に調べ、最初に当てはまったものを使う |
| 変換・検証（12.3.1 の後半） | `ReplanIntentLlmSchema` → `ReplanningIntentSchema`。キーワードと LLM で共通にするので、別の関数にしておく（置き場所は `lib/server/` など） |

12.3.2 の表：

| 条件 | 意図 |
|---|---|
| 疲れ・つかれ・しんど・だる・眠い・ねむい | `state_change`、`fatigue: "high"` |
| 「〇時(半)から」かつ 予定・用事・約束・バイト・会議 | `new_fixed_event`。「〇時(半)まで」があれば終了、「〇時間」があれば 開始＋その時間、どちらもなければ終了 null（C-10） |
| 勉強したくない・もうやりたくない・もう無理 | `task_change`：今日の now 以降のタスク項目すべてを `postpone` |
| 「明日に回」かつ 今日の now 以降のタスクのタイトルが発言に含まれる | `task_change`：そのタスクを `postpone` |
| それ以外 | `unknown` |

変換・検証：

- `task_changes[].task_id` が今日の now 以降のタスクにない → 捨てる
- `new_fixed_events`：時刻を今日の日時にする。終了 null → 開始＋60分（C-10。要約で「終わりの時刻が分からないため、1時間で仮置きしました。」を付けるので、仮置きしたことを覚えておく）。title null →「予定」。`category: "other"`、`location_id: null`、`recurrence: null`、`id`：UUID。開始が now より前・開始 ≥ 終了・終了が 24:00 超 → 捨てる
- 捨てた結果その type の中身が空 → `unknown`

**完了の条件**（単体テスト。`lib/llm/__tests__/` など）

- [ ] 「今日は疲れた」→ state_change・fatigue high
- [ ] 「20時から1時間予定が入った」→ new_fixed_event 20:00〜21:00
- [ ] 「20時から予定」→ 20:00〜21:00（仮置き）
- [ ] 「今日はもう勉強したくない」→ 今日の now 以降のタスクすべて postpone
- [ ] 「今日はいい天気」→ unknown

---

### 4. `POST /api/plans/replan`（Engine の手前まで）

**ブランチ**：`feature/replan-api`
**設計書**：12.1・12.2（処理の流れ 1〜10）

長沼の `replan()` を待たずに、12.2 の 1〜6 と 8〜10 を作る。7（Engine を呼ぶところ）は、`EngineReplanResultSchema` の形を返す**仮の関数**にしておき、★6 で本物に差し替える。

| 12.2 | 中身 | 注意 |
|---|---|---|
| 1 | `date` が今日でない → `{ supported: false, message: "今日の予定だけ変更できます。" }` | 今日は `getNow()` |
| 2 | 有効な計画がない・今週でない → 409（「先にプランを選んでください」） | |
| 3 | 意図を取り出す（3 の関数）。unknown・preference_change → 12.3.3 の返事 | `LLM_MODE=off` はキーワードだけ |
| 4 | new_fixed_events を今日の固定予定にする。今日の固定予定・睡眠と重なれば C-22 の返事 | 「19時から1時間予定が入った」は夕食と重なる → この返事になる（12.7） |
| 5 | Before：有効な計画の7日分。今日の項目には 11.3 の表示用の計算（locked・completed） | calendar と同じ計算を使う |
| 6 | PlanningContext：style ＝有効な計画の style、fixed_events に 4 の予定、locked_items ＝ Before の今日の locked な項目。**now をまたぐ自由時間・バッファは、作業用のコピーで now で切り、前半を locked_items に入れる**（Before の項目は切らない）。state_change なら今日の checkin の fatigue を更新 | now をまたぐ項目の扱いは 12.7 のテスト項目にもある |
| 7 | `replan(context, beforeDays, intent)`。`{ ok: false }` → `{ supported: false, message: reason ＋ required_changes }`（422 にしない） | ★6 までは仮の関数 |
| 8 | updated_days の全項目に新しい UUID。proposal の after と changes の after も同じ対応で置き換える。**before 側は元の id のまま** | 画面が before の id で「変更なし」を数える |
| 9 | `replan_proposals` に保存（base_version、expires_at ＝実際の現在時刻＋30分） | |
| 10 | `ReplanProposal` を返す | モックと同じ形 |

- **消すもの**：今の route の中の 18:00 への繰り上げ（`advanceToEighteenIfBefore()`）。繰り上げは画面（石渡の手順2）が `POST /api/mock/clock` で行う。API は `getNow()` をそのまま使う
- 仮の関数は、`mocks/replan-tired` の形を返すものでよい（★6 までの動作確認用）

**完了の条件**（仮の関数の段階）

- [ ] 明日の日付で送ると `supported: false`
- [ ] 計画を選ぶ前に送ると 409
- [ ] 「今日はいい天気」→ 12.3.3 の返事
- [ ] 「19時から1時間予定が入った」→ C-22 の返事（夕食と重なる）
- [ ] 「今日は疲れた」→ `replan_proposals` に行ができ、proposal が返る

---

### 5. `POST /api/plans/replan/accept`

**ブランチ**：4 と同じでよい
**設計書**：12.6

- `apply_replan(proposal_id)` を rpc で呼ぶ（`supabase/migrations/0002_functions.sql` にある）
- `PROPOSAL_EXPIRED` → 409（「時間がたったため、この提案は使えません。もう一度伝えてください。」）
- 返すもの：確定後の今日の `DayView`（11.3 の計算をかけたもの。calendar/day と同じ）
- 「やめておく」は API を呼ばない（提案は30分で無効）

**完了の条件**（12.7 の API の手動テスト）

- [ ] accept 前の `/today` は変更前のまま。accept 後の `/today` とカレンダーに反映される
- [ ] 同じ提案をもう一度 accept すると 409

---

### 6. 長沼の ★6 とつなぐ、モックの片付け

**待つもの**：長沼の ★6（`replan.ts`・`diff.ts`）

- [ ] 仮の関数を、長沼の `replan()` に差し替える
- [ ] 12.7 の API の手動テストをすべて通す
  - 「今日は疲れた」で 18:00〜18:30 休憩、18:30〜18:50 単語、18:50〜19:00 バッファ
  - 「20時から1時間予定が入った」で 20:00〜21:00 に予定が入り、19:45〜24:00 の自由時間が前後に分かれる（長沼の new_fixed_event が入ってから）
  - 「19時から1時間予定が入った」は入れられない返事
  - 「今日は疲れた」が `LLM_MODE=off` で通る
- [ ] 一時的な例外を消す（コードに `TODO` あり）
  - `POST /api/mock/reset` の `resetState()`（モックのストア）
  - `POST /api/mock/clock` のモックの時刻の更新
- [ ] 使わなくなった `lib/mock/*` を消す（`grep` で使われていないことを確かめてから。1.6）

---

### 7. Demo Path の通し確認（`LLM_MODE=off`）

**設計書**：16.3

`DEMO_MODE=1`、デモ用アカウント、リセット直後（10/5 7:00）、Chrome のスマホ表示（390px）で、次を1回で通す。

- [ ] ① ログイン → ② ヒアリング → ③ 目標時間3案が 9 / 6 / 3 時間
- [ ] ④ バランス標準型6時間で確定 → 自動ではスケジュールが作られない
- [ ] ⑤「スケジュール作成」→ 10秒以内に3案
- [ ] ⑥ 比較表の数値が案ごとに違い、どの案も目標（TOEIC）が6時間
- [ ] ⑦ バランスプランを選ぶ → ⑧ `/today` に10/5の計画。タスクの詳細に理由がある
- [ ] ⑨「今日は疲れた」→ ⑩ 10秒以内に変更前後 → ⑪「この計画にする」で `/today` とカレンダーに反映
- [ ] `GET /api/mock/check` の errors が0件
- [ ] `npm run typecheck`・`npm run lint`・`npm test` が通る

石渡の通し確認（①〜⑧）の報告と合わせて、見つかった問題を担当ごとに振り分ける（画面 → 石渡、Engine → 長沼、API → 柿澤）。

---

### 8. Vercel へのデプロイ

**設計書**：README 15.3

- 環境変数：`NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`・`SUPABASE_SECRET_KEY`・`DEMO_MODE=1`・`DEMO_USER_EMAIL`・`DEMO_USER_PASSWORD`・`LLM_MODE`（on にするなら `OPENAI_API_KEY`・`OPENAI_MODEL`）
- Node.js 24
- Supabase の Site URL（Authentication の URL 設定）に Vercel の URL を足す
- デプロイ後、7 の通し確認を Vercel の URL でもう一度行う

---

### 9. `LLM_MODE=on`（余裕があれば）

`off` で Demo Path が通った後に行う。失敗してもテンプレート・キーワードに戻る作りにする。

| 作るもの | 設計書 | 今のコードの TODO |
|---|---|---|
| `lib/llm/client.ts`（`callStructured()`。OpenAI を `fetch` で呼ぶ。SDK は入れない） | 2.4 | |
| ヒアリング（`lib/llm/interview.ts`）。失敗は 502、状態も発言も保存しない | 6.2.3 | `interview/message/route.ts` |
| 目標時間3案の文章（`lib/llm/goal-candidates.ts`）。失敗時はテンプレート | 7.2.3 | `lib/server/interview-script.ts` |
| 目標タスクの名前（`lib/llm/goal-task-names.ts`）。失敗時はテンプレート | 8.2 | `interview/confirm/route.ts` |
| 再計画の意図（`lib/llm/replan-intent.ts`）。失敗時はキーワード | 12.3.1 | |

16.3 は `on` と `off` の両方で通すことになっているが、時間がなければ `off` だけで発表できる（16.2）。

---

## 4. 待ち合わせ

| いつ | 柿澤がすること |
|---|---|
| 長沼の Draft PR が出た | `replan()` の関数の形が 10.2（`replan(context, beforeDays, intent) → EngineReplanResult`）のままか確認し、4 の仮の関数の形を合わせる |
| 長沼の ★6（state_change だけ）がマージ | 6 を始める（まず「今日は疲れた」だけ本物にする） |
| 長沼の new_fixed_event・task_change がマージ | 12.7 の残りの手動テスト |
| 石渡の手順1・2の PR | レビュー。`DEMO_MODE` なしで画面が動くか確認 |
| 石渡の通し確認の報告 | 問題を担当ごとに振り分ける |
| 通し確認で Engine の不具合 | 長沼に伝える（B は長沼がすべて持つ） |

`replan()` の関数の形を変えたい場合は、長沼から先に連絡をもらう約束になっている。

---

## 5. 既知のリスクと注意

- **Supabase 無料プランの一時停止**：発表の前日と当日の朝にログインして確かめる。止まっていたらダッシュボードで Restore
- **reset はトランザクションでない**：途中で失敗したら、もう一度 reset すれば直る
- **`task_done_logs.minutes`**：5の倍数でないと、PATCH で保存する値が DB の制約に引っかかる（計画の項目は5分単位なので起きない想定）
- **`backend-a-roadmap_2.md` が古い**：「B は未着手」「段階4・5は未着手」のまま。石渡が読んで混乱しないよう、このファイルに差し替えるか、冒頭に「古い」と書く
- **generate の時間**：`generatePlans` は約2.1秒（長沼の計測）。Vercel の関数の時間制限に余裕があるか、デプロイ後に確かめる

---

## 6. Claude Code への頼み方

```text
AGENTS.md と docs/design/README.md・common.md・<作業の章があるファイル> を読んでから作業してください。
docs/design/backend-a-handoff.md に、この作業の手順と決まりがあります。

## 今回の作業
<3章の番号と作業名>（<設計書の章>）
<backend-a-handoff.md の該当の中身と「完了の条件」を守る>

## ルール
- 最初に計画を見せてから実装する
- git の commit・push はしない（自分で行う）。変更したファイルの一覧とコミットメッセージの案を最後に出す
- lib/planning（長沼）と、app/(main)・app/(onboarding)・lib/api.ts・lib/labels.ts（石渡）は変えない
- lib/schemas.ts を変えない（変えたいときは先に報告）。パッケージを追加しない
- API のレスポンスは返す前にスキーマの .parse() を通す。パスと形はモックと同じにする
- 「今」は getNow() だけ。時刻の計算は lib/datetime.ts
- 設計書と違うところがあれば、最後の報告に「設計書との違い」として書く
- 終わったら npm test・npm run typecheck・npm run lint を実行し、結果を報告する。手動で確かめることの一覧も出す
```

### 例：3・4

```text
## 今回の作業
3：再計画の意図の取り出し（plans-replan.md 12.3.2・12.3.1 の変換・検証・12.3.3）
- lib/llm/replan-keywords.ts（発言 → ReplanIntentLlmSchema）
- ReplanIntentLlmSchema → ReplanningIntentSchema の変換・検証を別の関数にする（LLM でも使うため）
- 単体テストは backend-a-handoff.md の 3 の「完了の条件」

4：POST /api/plans/replan（plans-replan.md 12.2）
- 12.2 の 1〜6・8〜10 を作る。7 の Engine は EngineReplanResultSchema の形を返す仮の関数にする
- 今の route の advanceToEighteenIfBefore() は消す
```
