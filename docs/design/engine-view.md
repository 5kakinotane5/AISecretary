# 担当A：Claude Code への指示書（指示13：エンジンビュー＝状態を伝えるとパラメータが動く様子を別画面で見せる）

> 流れ・役割は backend-a-claude-code-tasks.md（指示1）と同じ。Cowork の Claude が指示書を書き、Claude Code が実装、コミット・push は柿澤。
> デモ用の機能。本番の動き（計画の結果・API の返事・DB に書く内容）は変えない。
> 番号：「予定が重なったときに聞く」（replan-add-tasks.md の指示12）と重ならないよう、こちらは**指示13**（13-1〜13-4）。

最終更新：2026-10-02（/today のチェックインを入口に追加。理解度メーターは作らない）

## やりたいこと（2026-10-02、柿澤）

- 発表で、AI秘書に今日の調子を伝えた**その場で**、Planning Engine のパラメータが動く様子を**別のウィンドウ**で見せる
- 入口は2つ：
  1. **/today の「今日の調子は？」**（気分・疲労・集中の3択＋決定）で「疲労：疲れている」を選んで決定
  2. **/replan** で「今日は疲れた」と話しかける
- 画面は、左に /today か /replan（スマホ幅）、右に `/engine-view`（PC 幅）を並べる
- **実際に SSE で動かして録画**し、発表ではその動画を使う
- 発表での言い方：「状態を理解して、その場で方針を変える」

## 方針

| 決めたこと | 理由 |
|---|---|
| **「理解度」のメーター・数値は作らない**。①に「把握している状態：疲れ 不明 → high」が埋まる様子を出し、それに合わせて②③④が動くのを見せる | 理解度という量は Engine にない。根拠のない数字を出さない。選択からの学習（P9.2）は一時的な状態では更新しない設計なので、「学習した」とも言わない |
| **処理の途中経過を、サーバーから別画面へリアルタイムに流す**（SSE） | 本物の動きを録画する。/replan の1ターンは LLM を含めて数秒かかるので「読み取り中 → 疲れを検出 → パラメータが変わる → 案を検査 → 返事」が本当に順番に届く |
| 送るのは A の担当のファイルから：チェックインの API（`POST /api/checkin` の route。実際のファイルは 13-1 の計画の段階で確かめる）と `lib/server/replan-chat/run.ts` | `lib/planning`（長沼）は**変えない**。必要な値は、すでに export されている関数（`adjustedDirections`・`adjustedBeamWeights`・`computeTaskFit`・`evaluateObjectives`・`buildSkeleton`・`buildFreeSlots`・`directionDistance`・`CONFIG`）を呼んで計算する |
| `ENGINE_VIEW=on` のときだけ動く | off なら何も計算しない・SSE は 404。テストと本番の結果に影響しない |
| 送る処理は失敗しても無視する | 別画面のせいでチェックイン・会話が止まらないようにする |
| 別画面は、届いた出来事を**最低 0.7 秒ずつ**順に見せる（画面側だけで待つ） | チェックインは LLM を使わず一瞬で終わるので、待たないと動きが見えない。API は遅くしない |
| パッケージを追加しない。グラフは SVG と CSS の transition で描く | |

## 入口ごとに動くもの

| 入口 | ① 把握している状態 | ② 3方向の目標・ビームの重み | ③ 今日のタスクの Fit | ④ 案の F(S) |
|---|---|---|---|---|
| /today「疲れている」→ 決定 | 疲れ 不明 → high | 動く（P9.1） | 高集中タスクの FatigueFit が 0、gate が閉じて「外す」 | **動かない**（チェックインでは計画を作り直さない。FR-08-14）。④には「今の計画」の F(S) と、方向との距離が変わる様子だけ出す |
| /replan「今日は疲れた」 | 疲れ 不明 → high（チェックイン済みなら変化なし） | 同上（変化があれば） | 同上 | 案を検査するたびに After が重なり、ゆとり（D_C）に近づく |
| /replan「木曜15時から1時間面接」など | 動かない | 動かない | 動かない | 案が1つ |

- **疲労の3択と値**：疲れている = high、少し疲れた = medium、元気 = low（の想定。13-1 で実装を確かめる）。P9.1 の②の調整は **high のときだけ**。medium では②は動かず、③の FatigueFit が 0.6 になるだけ
- **集中の「できなさそう」**（low）でも②（TaskFit +0.10・w2 +0.10）と③（ConcentrationFit）が動く。録画では、疲労の動きだけを見せたいなら集中は「ふつう」にする
- **気分**は Engine では使っていない（P2.1）。①には出すが、「計画には使っていません」と薄く添える

## 別画面に出すもの（`/engine-view`）

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ 入力：今日の調子「疲労：疲れている・集中：ふつう」  10/5 18:00     0.1 秒      │
│ ● 受付 ─ ● 状態を更新 ─ ◉ パラメータを再計算 ─ ○ 完了                       │
├───────────────────────┬────────────────────────────┬─────────────────────┤
│ ① 把握している状態（s_t）│ ③ 今日のタスクの適合度（Fit）│ ④ 計画の目的ベクトル（F(S)）│
│ 疲れ  不明 → high ✔    │ ES作成  17:35〜18:35        │  （レーダー：Before 灰色   │
│ 集中  不明 → medium ✔  │  Duration ███ 1.0           │   ＋ After を重ねる）     │
│ 気分  落ち込み気味      │  TimeOfDay ███ 1.0          │                        │
│   （計画には使っていません）│  Concentration ███ 1.0      │  方向との距離 d(S, D_k) │
│                       │  Fatigue ███ → ░ 0.0  ✕     │   ゆとり 0.38 → 0.21 ↓  │
│ ② 3方向の目標（D_k）   │  gate 1 → 0 ⇒ 外す          │                        │
│ 集中/バランス/ゆとり    │ TOEIC  20:00〜21:00          │  （/replan のとき）       │
│ Recovery  0.20→0.35 ↑  │  ...                        │  検査：案1 ✔ 案2 ✔       │
│ FreeTime  0.20→0.30 ↑  │                            │  やり直し 0 回           │
│ Achievement 1.00→0.90 ↓│                            │                        │
│ 今日のビームの重み（w_k）│                            │                        │
│ w5 Free ↑  w6 Over ↑   │                            │                        │
├───────────────────────┴────────────────────────────┴─────────────────────┤
│ ログ：+0.0s 受付（チェックイン）/ +0.1s 疲れ high に更新 / +0.1s 再計算 …        │
└──────────────────────────────────────────────────────────────────────────┘
```

- 上段の段階は入口で変える。チェックイン：受付 → 状態を更新 → パラメータを再計算 → 完了。/replan：受付 → AIが読み取り → 状態を更新 → 案を検査(n) → 返事
- **動く瞬間**：疲れが更新されたとき（`state_update`）に、①の「不明」が「high」に埋まり、②の棒が伸び縮みし（変化量を ↑↓ と色で示す）、③の FatigueFit が 0 に落ちて gate が閉じ、そのタスクに「外す」が付く
- ④：チェックインでは「今の計画」の F(S) は変わらず、**方向との距離**（D_k が動くため）が変わる。/replan では案を検査するたびにレーダーに After が1つずつ重なり、各案が D_A・D_B・D_C のどれに一番近いかを出す
- 状態が `null` のときの表記は「不明」（「なし」にしない）
- 文字は大きめ（Zoom・録画で読めるよう 16px 以上）。各パネルの見出しは「日本語（記号）」の形
- 画面に「理解度」という言葉・数値は出さない

## 順番

| 指示 | 内容 | ブランチ | 優先度 |
|---|---|---|---|
| 13-1 | サーバー：出来事の型・計算・SSE・チェックインの API と run.ts から送る | `feature/engine-view`（新規。main から） | A |
| 13-2 | 画面：`/engine-view` | 同じブランチ | A |
| 13-3 | 手動確認と録画のリハーサル（Cowork の Claude と柿澤、`LLM_MODE=on`・`ENGINE_VIEW=on`） | — | A |
| 13-4 | （余裕があれば）/plans の生成の結果も出す | 同じブランチ | B |

### 始める前に（柿澤）

- run.ts は指示11・指示12（`feature/replan-add-items`）でも変えているので、**それらを main にマージしてから**始める（衝突を避ける）
- `lib/planning` は触らないが、別画面で Engine の値を見せることは長沼さんにひと声かけておく

```bash
git switch main
git pull origin main
git switch -c feature/engine-view
```

- `.env.local` に `ENGINE_VIEW=on` を足す（デモの PC だけ。`.env.example` には `ENGINE_VIEW=off` を足す）
- このファイルを、リポジトリの `docs/design/engine-view.md` に置き、最初のコミットにする：
  `git add docs/design/engine-view.md && git commit -m "docs: エンジンビュー（状態を伝えるとパラメータが動く様子を別画面で見せる）の設計を追加する"`

---

## 13-1：サーバー

完了の条件：

- [ ] 下の「テスト」が通る。今までのテスト（チェックイン・replan-chat・/api/plans/replan）がそのまま通る
- [ ] `ENGINE_VIEW` が on でないとき、追加の計算が1回も走らない（テストで確かめる）
- [ ] `npm test`・`npm run typecheck`・`npm run lint` が通る

```text
最初に git status で、今いるブランチが feature/engine-view で、未コミットの変更がないことを確かめてください。違えば止めて報告する。

AGENTS.md と docs/design/README.md・common.md・backend.md（9.3）・planning.md（10.6・付録P の P2.1・P4・P5.4・P6・P8・P9.1）・replan-chat.md（12.11〜12.14）・docs/design/engine-view.md を読んでから作業してください。

## 背景
発表のデモで、AI秘書に今日の調子を伝えた瞬間に、Planning Engine のパラメータ（状態 s_t、方向ベクトル D_k、今日のビームの重み w_k、今日のタスクの Fit、計画・案の目的ベクトル F(S)）が変わる様子を別ウィンドウ（/engine-view）で見せ、録画する。
入口は2つ：/today の「今日の調子は？」（気分・疲労・集中の3択＋決定）と、/replan の会話。
今回（13-1）はサーバー側だけ。処理の途中で「出来事」を送り、SSE で別画面に流す。画面は次回（13-2）。
本番の動き（計画の結果・API の返事・DB に書く内容）は一切変えない。lib/planning は変えない（import して使うのはよい）。
「理解度」のような数値は作らない。

## 計画の段階で確かめて報告してほしいこと（実装の前に）
- /today の「今日の調子は？」の「決定」が呼ぶ API と、その route のファイル。送る値（mood・fatigue・concentration）と、3択の表示と値の対応（疲れている = high、少し疲れた = medium、元気 = low のはずか）
- 決定の後に、計画の作り直し・再計画など、ほかの処理が走るか（設計では走らない。FR-08-14）
- 今の有効な計画の7日分（beforeDays）と PlanningContext を、run.ts がどう作っているか。チェックインの API から同じ関数で作れるか

## 今回やること
1. lib/server/engine-view/events.ts：出来事の型（zod は不要。TypeScript の型だけ）
   共通：{ seq（連番）, turn_id, user_id, source: "checkin" | "replan", t_ms（始まりからの経過）, type, ... }
   - turn_start：{ text（replan は発言。checkin は「疲労：疲れている・集中：ふつう・気分：落ち込み気味」のような表示用の文）, now, snapshot: ParamSnapshot, before_features: ObjectiveVector | null, before_distances: { intensive, balanced, relaxed } | null }
   - llm_start：{ call（1〜3）, feedback_count }（replan だけ）
   - llm_result：{ call, ms, reply_type, fatigue, options: { label, ops: string[] }[] }（replan だけ。ops は「postpone ES作成」「add_event 18:00〜19:00」のような短い文字列）
   - state_update：{ before: ParamSnapshot, after: ParamSnapshot, after_distances: { intensive, balanced, relaxed } | null }（今日のチェックインの疲れ・集中が変わったときだけ。after_distances は「今の計画」の F(S) と、更新後の D_k との距離）
   - option_check：{ call, index, label, ok, errors, warnings, changes（変更の件数）, after_features: ObjectiveVector | null, distances: { intensive, balanced, relaxed } | null }（replan だけ）
   - retry：{ call, reasons: string[] }（replan だけ）
   - fallback：{ reason: "llm_off" | "llm_error" }（replan だけ）
   - turn_end：{ ms, reply_type（checkin は "checkin"）, proposals（件数。checkin は 0）, message }
   ParamSnapshot = { checkin: { fatigue, concentration, mood }, directions: AdjustedDirections, beam_weights: Record<PlanStyle, number[]>（6成分）, today_fits: FitRow[] }
   FitRow = { item_id, title, start_at, end_at, high_concentration, duration_fit, time_of_day_fit, concentration_fit, fatigue_fit, interrupt_fit, split_fit, q, gate, fit }

2. lib/server/engine-view/snapshot.ts：純粋関数（DB・時計・環境変数に触れない）
   - buildParamSnapshot(context, beforeDays)：
     directions = adjustedDirections(context)、beam_weights = 3つの style ごとの adjustedBeamWeights(context, style, 今日)
     today_fits = 今日の項目のうち kind が task で end_at > now、status が completed でないもの（時刻順）。
     Fit の計算は lib/planning/replan.ts の state_change で Fit を求めている所と同じ形（開始は max(start_at, now)、slot は その時刻〜work_end）で computeTaskFit を呼ぶ。high_concentration は isHighConcentrationTask
   - computeFeatures(context, days)：evaluateObjectives(context, days, { slots })。slots は buildSkeleton(context) と buildFreeSlots で作る。
     evaluateObjectives は dayResults がないと task_fit が常に 1 になるので、task_fit だけは「now より後のタスク項目の computeTaskFit の q を、分数で加重平均したもの」で上書きする（タスクがなければ 1）
   - directionDistances(features, directions)：directionDistance を3方向ぶん
   どれも例外を投げたら null を返す形にしてよい（画面に「計算できませんでした」と出す）

3. lib/server/engine-view/bus.ts：
   - isEngineViewEnabled()：process.env.ENGINE_VIEW === "on"
   - globalThis に1つだけ EventEmitter と直近 300 件のリングバッファを置く（dev の HMR で二重にならないように globalThis のキーで持つ）
   - publish(event)：seq を振ってバッファに入れ、emit。中で例外が出ても外に投げない
   - subscribe(userId, afterSeq, listener)：afterSeq より後のバッファ分を先に渡してから、新しい出来事を渡す。解除の関数を返す

4. app/api/debug/engine-events/route.ts（GET、SSE）：
   - export const runtime = "nodejs"、export const dynamic = "force-dynamic"
   - ENGINE_VIEW が on でなければ 404
   - requireUser で利用者を取り、その user_id の出来事だけを流す
   - クエリ after（seq）があれば、それより後のバッファ分から流す
   - text/event-stream。1件ずつ `data: {json}\n\n`。15秒ごとに `: ping\n\n`。request.signal の abort で subscribe を解除して閉じる

5. チェックインの API（計画の段階で確かめた route）：
   - isEngineViewEnabled() のときだけ、保存の**前**に PlanningContext と有効な計画の days を作って buildParamSnapshot・computeFeatures・directionDistances を計算し turn_start を送る。保存の**後**に、保存した値を入れた context で buildParamSnapshot・directionDistances を計算し、疲れか集中が変わっていれば state_update、最後に turn_end
   - 有効な計画がない日は today_fits を空、features・distances を null にする
   - この処理は try/catch で囲み、失敗しても API の返事・保存は今まで通り。off のときは context も作らない
   - 計算の部分は route に直接書かず、lib/server/engine-view/ に関数を置いて呼ぶ（テストできるように）

6. lib/server/replan-chat/run.ts：
   - ChatTurnDeps に emit?: (event) => void を足す（省略可能。テストの既存の deps はそのままで動くこと）
   - runReplanChatTurn の次の場所で emit する（deps.emit がなければ、計算も含めて何もしない）
     ターンの始まり（turn_start）、callReplanChat の前後（llm_start・llm_result）、疲れを更新したとき（state_update：更新の前後の context で buildParamSnapshot）、各案の checkOption の後（option_check：ok なら After の days を作って computeFeatures・directionDistances）、全部だめでやり直すとき（retry）、fallback に入るとき、返事を返すとき（turn_end。どの return からでも1回だけ出るようにする）
   - runReplanChat：isEngineViewEnabled() のときだけ、turn_id（crypto.randomUUID()）・user_id・開始時刻を閉じ込めた emit を作って deps に渡す
   - option_check の After の days は、checkOption の結果の updated_days を beforeDays に重ねたもの（check.ts と同じ作り方）

## テスト（lib/server/engine-view/__tests__/）
- snapshot：fixtures（10/5 18:00、TOEIC バランス）で、チェックインの fatigue が null → high にすると
  directions の 3方向すべてで recovery が +0.15・free_time が +0.10・achievement が −0.10（0〜1 に収めた値）、
  beam_weights の今日の w5 が +0.10・w6 が +0.20、
  today_fits の TOEIC リスニング演習の fatigue_fit が 0・gate が 0 になる
- snapshot：fatigue が null → medium では directions・beam_weights が変わらない（P9.1 は high だけ）。高集中タスクの fatigue_fit が 0.6
- computeFeatures：Before の features の 7成分がすべて 0〜1。task_fit が 1 固定になっていない
- チェックインの計算の関数：fatigue null → high で「turn_start → state_update → turn_end」の順。同じ値で送り直すと state_update が出ない。有効な計画がないとき例外にならず features が null
- bus：subscribe した後の publish が届く。after より前の分は届かない。listener が例外を投げても publish は投げない
- run（既存の run.test.ts の作り方。LLM はモック）：emit を渡すと「turn_start → llm_start → llm_result → … → turn_end」の順で出る。「今日は疲れた」で state_update が1回出る。emit を渡さないとき、snapshot の関数が呼ばれない（vi.spyOn などで確かめる）
- SSE の route は単体テストしなくてよい（13-3 で手で確かめる）

## ルール
- 最初に計画（と、上の「確かめて報告してほしいこと」の答え）を見せてから実装する
- git の commit・push はしない。変更したファイルの一覧とコミットメッセージの案を最後に出す
- lib/planning は変えない。パッケージを追加しない。マイグレーションは作らない
- API の返事・DB に書く内容・ログの内容を変えない
- 時刻の計算は lib/datetime.ts を使う
- 設計書と違うところがあれば「設計書との違い」として書く
- 終わったら npm test・npm run typecheck・npm run lint の結果を報告する
```

### 13-1 の結果（2026-10-02、Claude Code の報告）

- 決定 → `saveCheckin()`（lib/api.ts）→ `POST /api/checkin`（app/api/checkin/route.ts）。`{ date, mood, fatigue, concentration }` を1回で送る。表示と値は lib/labels.ts のとおり（疲れている = high など、想定どおり）
- 決定の後は upsertCheckin だけ。計画の作り直し・再計画は走らない
- context・7日分は `loadReplanBase()`（lib/server/replan-base.ts）を再利用。有効な計画がないとき（409）は style なしの context で続け、計画まわりは空・null
- 新規：lib/server/engine-view/（events・snapshot・bus・checkin・load・replan）、app/api/debug/engine-events/route.ts。変更：app/api/checkin/route.ts、lib/server/replan-chat/run.ts。テスト4本・19件
- npm test 603件成功（1件スキップ）・typecheck・lint 通過
- 設計書との違い：`workEnd()` は lib/planning/replan.ts の外から呼べないため、同じ式を snapshot.ts に写した（式が変わったら両方直す）。例外のときも turn_end（reply_type "error"）を1回出してから投げ直す
- 分かっている制限（受け入れる）：
  - fallback（LLM off・LLM の失敗）で疲れが保存されたときは state_update が出ない。発表は LLM_MODE=on。録画中に LLM が失敗したら撮り直す
  - option_check の errors に Engine・Validator の内部の理由が入る。本人の画面だけ・ENGINE_VIEW=on のときだけなのでよい
  - 出来事はプロセスのメモリにあるので、ローカルの dev 1つで動かす前提

### 設計書との違い

| 項目 | 設計書・指示 | 実装 | 理由 |
|---|---|---|---|
| Fit の work_end | lib/planning/replan.ts の state_change と同じ形 | `workEnd()`（就寝の30分前）は replan.ts の外から呼べないため、**同じ式を `lib/server/engine-view/snapshot.ts` に写した** | lib/planning を変えないため。式が変わったら両方直す |
| 例外のときの turn_end | どの return からでも1回だけ | runReplanChatTurn の中で例外が出たときも、**turn_end（reply_type `"error"`・proposals 0・message 空）を1回出してから投げ直す** | 別画面のターンが終わらないままにならないように |
| fallback の state_update | 疲れを更新したときに出す | **fallback（LLM_MODE=off・LLM の失敗）の経路で疲れが保存されたときは出ない**（その経路は replanByIntent の中で保存していて、emit の場所にないため） | 受け入れる（発表は LLM_MODE=on） |
| 出来事の型の置き場所 | `lib/server/engine-view/events.ts` | 13-2 で **`lib/engine-view/events.ts`** に移した | 画面（components/engine-view）からも型を使うため。lib/server は画面から import しない |
| SSE の `after` | after があれば、それより後のバッファ分から | 13-2 で、**after がないときはバッファを流さず新しい出来事だけ**にした | 別画面を開いた瞬間に過去の出来事（最大300件）が流れないように。つなぎ直しは最後の seq を after に付ける |
| ENGINE_VIEW が off のときの画面 | 「ENGINE_VIEW=on で起動してください」とだけ出る | その一文と、右上の接続の状態「ENGINE_VIEW が off」を出す。off の判定は page.tsx（サーバー）で行い、SSE には接続しない | 13-2 の「接続の状態を右上に出す」とあわせるため |

---

## 13-2：画面 `/engine-view`

完了の条件：

- [ ] `ENGINE_VIEW=on` で `/engine-view` を開き、別タブの /today で「疲労：疲れている」→ 決定すると、①②③と④の距離が順に動く
- [ ] 別タブの /replan で「今日は疲れた」と送ると、①〜④が順に動く
- [ ] `ENGINE_VIEW` が off のとき、`/engine-view` は「ENGINE_VIEW=on で起動してください」とだけ出る
- [ ] `npm test`・`npm run typecheck`・`npm run lint` が通る

```text
同じブランチ（feature/engine-view）で続けてください。最初に git status で、ブランチと未コミットの変更がないことを確かめる。違えば止めて報告する。

docs/design/engine-view.md の「入口ごとに動くもの」「別画面に出すもの」を読んでから作業してください。前回（13-1）で、出来事の型（lib/server/engine-view/events.ts）と SSE（GET /api/debug/engine-events）ができている。まずそれを読むこと。

## 今回やること
1. app/engine-view/page.tsx（(main) の外に置く。下のナビは出さない。ログインは proxy.ts のとおり必要）と components/engine-view/ 以下
   - PC 幅（1280px 前後）の横長の画面。上段に入力と処理の段階、左に①把握している状態・②3方向の目標 D_k と今日のビームの重み w_k、中央に③今日のタスクの Fit、右に④F(S) のレーダーと方向との距離・検査の結果、下段にログ
   - EventSource で /api/debug/engine-events に接続する。切れたら最後の seq を after に付けてつなぎ直す
   - 届いた出来事はキューに入れ、最低 700ms ずつ順に画面に反映する（キューが 10 件を超えたら 300ms に縮める）
   - turn_start で画面を新しいターンに切り替える（前のターンの値は、変化の起点として残す）
   - 段階の表示は source で変える。checkin：受付 → 状態を更新 → パラメータを再計算 → 完了。replan：受付 → AIが読み取り → 状態を更新 → 案を検査 → 返事
2. ①把握している状態（s_t）
   - 疲れ・集中は、null を「不明」と出す。値が入ったら「不明 → high」の形で埋まる動きと ✔ を付ける
   - 気分は値だけ出し、「計画には使っていません」と薄く添える
   - 「理解度」という言葉・数値は出さない
3. 動きの見せ方（パッケージは追加しない。SVG と CSS の transition）
   - 棒グラフの長さと数値は 600ms で前の値から新しい値へ動かす（数値は requestAnimationFrame でカウントアップ）
   - 変化した値には差分（+0.15 / −0.10）と ↑↓ を付け、増加と減少で色を分ける。2秒ほど目立たせてから落ち着かせる
   - ③で gate が 0 になった行は、行全体を薄くして「外す」の札を付ける
   - ④のレーダーは7軸（達成・締切の安全・適合・バッファ・空き時間・コントロール・回復）。Before は灰色、案ごとに色を変えて重ねる。D_A・D_B・D_C は点線で薄く出し、各案がどれに一番近いかを文字で出す
   - ④の方向との距離は、checkin のときは「今の計画」について Before → After（state_update の after_distances）を出す（D_k が動くので距離が変わる）
4. 見た目
   - 既存の色・フォントの決まり（globals.css・lib/brand.ts）に合わせる。ダークな背景にしない（Zoom・録画で見づらい）
   - 文字は 16px 以上、数値は等幅の数字（font-variant-numeric: tabular-nums）
   - 見出しは「日本語（記号）」の形。画面上の表記は「空き時間」（「自由時間」「余白」は使わない）
5. 接続の状態を右上に出す（接続中・つなぎ直し中・ENGINE_VIEW が off）
6. 13-1 の残り：
   - .env.example に `ENGINE_VIEW=off`（「on にすると /engine-view でパラメータの動きを見せる。デモの PC だけ」のコメント付き）、docs/design/README.md の 15.3（環境変数）に1行足す
   - docs/design/engine-view.md の「設計書との違い」に、workEnd() の式を snapshot.ts に写したこと・例外時の turn_end（reply_type "error"）・fallback では state_update が出ないことを書く
   - npm test でスキップされている1件が、今回より前からあるものか確かめて報告する

## ルール
- 最初に計画（コンポーネントの分け方と、キューで順に見せる仕組み）を見せてから実装する
- git の commit・push はしない。変更したファイルの一覧とコミットメッセージの案を最後に出す
- /today・/replan など既存の画面は変えない。パッケージを追加しない
- 終わったら npm test・npm run typecheck・npm run lint の結果と、手で確かめる手順を報告する
```

---

## 13-3：手動確認と録画のリハーサル（`LLM_MODE=on`・`ENGINE_VIEW=on`）

デモ用アカウントのリセットは長沼に声をかけてから。10/5 18:00、TOEIC バランス。**毎回、今日のチェックインを空に戻してから**始める。

| 操作 | 見えるはずのこと |
|---|---|
| /today：疲労「疲れている」・集中「ふつう」→ 決定 | ①疲れ 不明 → high。②が動く（Recovery ↑・FreeTime ↑・Achievement ↓、w5・w6 ↑）。③で高集中タスクの FatigueFit が 0・「外す」。④は今の計画の、ゆとり（D_C）との距離が変わる |
| /today：疲労「少し疲れた」→ 決定 | ①は medium。②は動かない。③の FatigueFit が 0.6（正しい動き。録画には使わない） |
| /replan：今日は疲れた（チェックインが空の状態から） | ①〜④がすべて動く。④の案がゆとり（D_C）に近づく |
| /replan：木曜15時から1時間面接 | ①②③は動かない。④に案が1つ。llm_result の ops に add_event |
| /replan：レポートやらなきゃ | llm_result が question。④は空のまま、turn_end |

- 1ターンの応答時間が、エンジンビューを開いていないときと比べて目立って遅くならないこと（差を backend-a-progress.md に書く）
- 録画：左に /today か /replan（スマホ幅）、右に /engine-view を並べて、実際に操作して撮る。何テイクか撮って良いものを使う

## 13-4（余裕があれば）：/plans の生成も出す

- `POST /api/plans/generate` の後に、状態で調整した D_k、選ばれた3案の F(S)、`planDistances` の3つの距離と D_min を出来事として送り、④に「3案の生成」として出す
- 候補の数（18通り・54通り・Pareto の件数）やビームの途中は `lib/planning` の中にしかないので、**今回はやらない**（長沼さんと相談してから）

## 時間がないときの削り方

- 先に削る：13-4、/replan の入口（/today だけにする）、④のレーダー（数値の表にする）、つなぎ直し
- 残す：①②③の「疲れ → パラメータが動く → タスクが外れる」（一番伝わる部分）と、段階のステップ表示
