# 担当A：Claude Code への指示書（指示8〜：会話で再計画する）

> 流れ・役割は backend-a-claude-code-tasks.md（指示1）と同じ。
> 仕様は **`docs/design/replan-chat.md`（12.8〜12.15）**。この文書は、作業の分け方・完了の条件・依頼文だけを書く。

最終更新：2026-10-02

## 決めたこと（2026-10-02、柿澤）

- AI は「自由に会話して提案を考える秘書」にする。`docs/scenarios/` の挙動を目指す
- LLM は**操作**を出し、時刻の計算・並べ直し・検査は**コード**が行う。文章の数字はコードの値だけを使う
- 今の経路（意図3種類＋Engine）は **fallback として残す**。`LLM_MODE=off` と LLM の失敗時はそちら。Demo Path（18:00「今日は疲れた」）は壊さない
- 案は1〜3個。会話の履歴は画面が持つ（サーバーに保存しない）

## 今のコードで分かっていること（2026-10-02、main = #60）

- `app/api/plans/replan/route.ts` に 12.2 の 1〜10 が全部入っている。準備（1・2・5・6）を切り出せば会話の経路でも使える
- `buildReplanRows()` は `Extract<EngineReplanResult, { ok: true }>` を受ける。`applyOps()` を同じ形で返せば保存はそのまま使える
- `validatePlan(context, days, "replan", { before })` は `GOAL_HOURS_MISMATCH` を errors にする。会話の経路では warnings に移す（`lib/planning` は変えない）
- `apply_replan` は accept のとき、同じ日の他の pending を discarded にする。案が複数でも DB は変えなくてよい
- `computeReplanImpact()`（`lib/replan-impact.ts`）は純粋関数。サーバーで facts を作るのに使える
- `callStructured()` は system・user の2つだけ送る。履歴は user の JSON に入れる
- 作業中：`fix/replan-colloquial-intent`（口語のキーワード。未コミット）。**指示8 はこれを main に入れてから始める**（fallback の判定がよくなる）

## 順番と優先度

| 指示 | 内容 | 担当 | 優先度 |
|---|---|---|---|
| 8 | サーバー：操作・当てはめ・検査・LLM・API | 柿澤（Claude Code） | A（発表に必須） |
| 9 | 画面：会話の履歴・複数案・警告 | 石渡と相談（`app/(main)`・`lib/api.ts` は石渡のファイル） | A |
| 10 | 確定した後の取り消し（`undo`） | 柿澤 | B（時間があれば） |

---

## 指示8：会話の再計画（サーバー）

**ブランチ**：`feature/replan-chat`（新規。main から）
**設計書**：`docs/design/replan-chat.md`（12.8〜12.15）、plans-replan.md 12.2・12.4・12.5

### 始める前に（柿澤）

```bash
git switch main
git pull origin main
git switch -c feature/replan-chat
# docs/design/replan-chat.md がまだ main になければ、このブランチで最初にコミットする
```

### 完了の条件

- [ ] 12.15 の単体テストがすべて通る
- [ ] `LLM_MODE=off`：`POST /api/plans/replan/chat` に「今日は疲れた」→ source "fallback"、今と同じ提案（18:00〜18:30 休憩、18:30〜18:50 単語、18:50〜19:00 バッファ）
- [ ] `POST /api/plans/replan` の動きが変わらない（今あるテストがそのまま通る）
- [ ] `npm test`・`npm run typecheck`・`npm run lint` が通る

挙動（Cowork の Claude が確かめる。`LLM_MODE=on`、10/5 18:00、TOEIC バランスの計画。リセットは柿澤に声をかけてから）：

- [ ] 「急に友達から飲み会に誘われた、20時から22時」→ 20:00〜22:00 に予定、重なっていたタスクは後ろか別の日。Validator の errors 0（`/api/mock/check`）
- [ ] 「19時から飲み会」→ 夕食と重なる理由を踏まえた案（例：19:45〜）か質問。500 にならない
- [ ] 「めちゃくちゃ眠い」→ 2案（tired_plan と仮眠）。チェックインの fatigue が更新される
- [ ] 「今から30分散歩したい」→ 18:00 から散歩、後ろがずれる
- [ ] 「電車が30分遅れてる」→ 今日の残りが30分以上後ろにずれる
- [ ] 「残り全部2時間で終わらせて」→ できる範囲の案。文章が「できません」だけで終わらない
- [ ] 「今日のTOEICやめて自由にしたい」→ warnings に目標の不足（分）。文章にも同じ数字
- [ ] 2案が出たあと「案2で」→ selected_proposal_id が2つ目。「やっぱりナシ」→ discarded
- [ ] 「ワンチャン明日でよくね？」→ postpone の案
- [ ] どの返事も、文章の数字が `computeReplanImpact` の値と一致する
- [ ] 応答時間（1ターン）を記録する。15秒を超えない

### Claude Code に貼る依頼文

```text
AGENTS.md と docs/design/README.md・common.md・plans-replan.md（12章）・docs/design/replan-chat.md（12.8〜12.15）を読んでから作業してください。
docs/scenarios/ も読んでください（目指す挙動）。

## 今回の作業
再計画を「会話で提案する」形にする。LLM は操作（replan-chat.md 12.9）を出し、時刻の計算・並べ直し・検査はコードが行う。
今の経路（POST /api/plans/replan、意図3種類＋Engine）は fallback として残し、動きを変えない。

やること（replan-chat.md の節の順）：
1. lib/schemas.ts に 12.9 のスキーマと型を足す（既存のスキーマは変えない。足す内容を最初の計画で見せる）
2. lib/server/replan-base.ts：app/api/plans/replan/route.ts の 1・2・5・6（今日だけ・有効な計画・Before・PlanningContext・engineBeforeDays・storedRows）を切り出す。route.ts はそれを使う形にし、動きは変えない
3. lib/server/replan-chat/apply-ops.ts：12.10 の applyOps（純粋関数。DB・LLM・時計に触れない）
4. lib/server/replan-chat/check.ts：12.11 の checkOption（tired_plan は replan() を呼ぶ。GOAL_HOURS_MISMATCH は warnings に移す）
5. lib/llm/replan-chat.ts：12.13 ① のプロンプトと呼び出し（callStructured。ReplanChatLlmSchema）
6. lib/llm/replan-chat-message.ts：12.12・12.13 ② の説明文、facts の作成、数字の検査、テンプレート
7. lib/server/replan-chat/run.ts：12.11 の1ターンの流れ（再試行は最大2回、全体15秒）
8. lib/server/repositories/replan-proposals.ts に discardReplanProposals(supabase, ids)
9. app/api/plans/replan/chat/route.ts：12.14
10. docs/design/plans-replan.md の12章の頭に「会話の経路は replan-chat.md」と1行足す。README.md の目次にも足す

### テスト（12.15）
- lib/server/replan-chat/__tests__/apply-ops.test.ts：lib/planning/__tests__/fixtures.ts と replan.test.ts と同じ作り方でバランスプランを生成し、now = 10/5 18:00 で各操作を当てはめ、validatePlan の errors が0件になること
- lib/server/replan-chat/__tests__/run.test.ts：callStructured をモックして、再試行・select・discard・chat・fallback
- lib/llm/__tests__/replan-chat-message.test.ts：数字の検査とテンプレート

## ルール
- 最初に計画を見せてから実装する。applyOps の手順で設計書に書いていない判断が要るところは、計画の段階で質問する
- git の commit・push はしない（自分で行う）。変更したファイルの一覧とコミットメッセージの案を最後に出す
- lib/planning（長沼）と、app/(main)・app/(onboarding)・lib/api.ts・lib/labels.ts（石渡）は変えない。lib/planning の関数（validatePlan・replan・ReplanDiffBuilder）は import して使ってよい
- パッケージを追加しない。DB のマイグレーションは作らない
- 「今」は getNow() だけ。時刻の計算は lib/datetime.ts
- LLM のログは name・所要時間・成否・エラーの種類だけ。発言の文章を console に出さない
- テストで実際の OpenAI は呼ばない（fetch か callStructured をモック）
- API のレスポンスは返す前にスキーマの .parse() を通す
- 設計書と違うところがあれば、最後の報告に「設計書との違い」として書く
- 終わったら npm test・npm run typecheck・npm run lint を実行し、結果を報告する。手動で確かめることの一覧も出す
```

---

## 指示9：会話の再計画（画面）

**ブランチ**：`feature/replan-chat-ui`（指示8 のあと。main から）
**設計書**：replan-chat.md 12.14、frontend.md 14.2（/replan）
**注意**：`app/(main)/replan/page.tsx`・`lib/api.ts`・`lib/labels.ts` は石渡のファイル。**石渡に頼むか、柿澤が触ってよいか確かめてから**始める

### 決めること（画面）

- 送信は `POST /api/plans/replan/chat`。`history` は画面の吹き出しの直近10件（今回の発言は含めない）、`open_proposal_ids` は出ている案
- 案が2つ以上なら、AI の吹き出しの下に「案1：{label}」「案2：{label}」の切り替え（セグメント）。選んだ案の `ReplanImpact`・`ChangeList` を出す。初期は案1
- `selected_proposal_id` が来たら、その案に切り替える
- `discarded: true` なら出ている案を消す
- `warnings` は「この計画にする」の上に1行ずつ（注意の色 `--deadline-fg`。赤は使わない）
- 「この計画にする」は選んでいる案を accept。「やめておく」は今と同じ
- `?text=` の自動送信と、18:00 への繰り上げは今のまま

### Claude Code に貼る依頼文

```text
AGENTS.md・docs/design-spec.md・docs/design/frontend.md（14.2）・docs/design/replan-chat.md（12.14）を読んでから作業してください。

## 今回の作業
/replan を会話の再計画 API（POST /api/plans/replan/chat）に切り替える。

やること：
1. lib/api.ts に requestReplanChat(body: ReplanChatRequest): Promise<ReplanChatResponse> を足す（requestReplan は残す）
2. app/(main)/replan/page.tsx
   - sendText は requestReplanChat を使う。history は今の messages の直近10件（今回の発言は含めない）、open_proposal_ids は出ている案の id
   - message を AI の吹き出しに出す
   - proposals が2つ以上なら、吹き出しの下に「案1：{label}」…の切り替え（components/common/segment.ts のセグメント）。選んだ案の ReplanImpact・ChangeList・比較を出す。初期は案1
   - selected_proposal_id が来たらその案に切り替える。discarded なら案を消す
   - warnings は「この計画にする」の上に1行ずつ（--deadline-fg）
   - 「この計画にする」は選んでいる案の proposal_id で acceptReplan
3. 文言は lib/labels.ts の REPLAN_LABELS に足す

## ルール
- 最初に計画を見せてから実装する
- git の commit・push はしない。変更したファイルの一覧とコミットメッセージの案を最後に出す
- lib/schemas.ts・lib/planning・app/api は変えない
- 390px で崩れないこと。タップ領域は44px以上
- 終わったら npm test・npm run typecheck・npm run lint を実行し、結果を報告する。手動で確かめることの一覧も出す
```

---

## 指示10：確定した後の取り消し（優先度B）

**ブランチ**：`feature/replan-undo`（指示9 のあと）

### 決めること

- `replan_proposals` に `undo_days jsonb`（accept 前の、updated_days と同じ日の行）を足す（`0004_replan_undo.sql`）。status に `undone` を足す
- 提案の保存のとき、`listPlanItemRows()` の値から `undo_days` を作る
- `undo_replan(p_proposal_id)`：status が accepted で、`weekly_plans.version = base_version + 1` のときだけ。undo_days で戻し、足した固定予定を消し、version を1上げ、status を undone にする。それ以外は `UNDO_EXPIRED`
- `POST /api/plans/replan/undo`（`{ proposal_id }`）→ その日の DayView
- 会話：出ている案がなく、今日 accept した提案があるときの「元に戻して」→ 操作 `undo_last`（12.9 に足す）→ 画面に「元に戻す」ボタン

依頼文は、指示8・9 が入ってから書く。

---

## 設計書の更新（指示8 で一緒に）

- `docs/design/replan-chat.md`（新規。この仕様）
- plans-replan.md 12章の頭に1行、README.md の目次に1行
- `docs/scenarios/` は今のまま「目指す挙動」として使う。手動で確かめた結果は backend-a-progress.md に書く
