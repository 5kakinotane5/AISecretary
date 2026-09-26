# 設計書：3案の保存・選択、表示、再計画、理由（11〜13章）

> 設計書（`docs/design/`）の一部。目次・章とファイルの対応は [README.md](README.md)。章番号は設計書全体で共通。

## 11. 3案の保存・選択、今日のタイムライン、カレンダー（F-08 後半・F-10・F-11）

### 11.1 3案の保存と選択

| ID | 要件 |
|---|---|
| FR-08-11 | `POST /api/plans/generate`（`{ session_id }`）：下の手順で3案を作って保存し、`{ candidates }`（intensive・balanced・relaxed の順）を返す |
| FR-08-12 | `GET /api/plans/candidates`：最新の生成（`created_at` が最も新しい `generation_id`）で、`week_start` が今週のものの3案。なければ空配列 |
| FR-08-13 | `POST /api/plans/{id}/select`：`select_plan(id, getNow())` を呼び、`{ active_plan_id }` を返す。id が候補でなければ404。優先度B：あわせて P9.2 の学習で `user_settings.preference_weights` を更新する（選ばれた案と、同じ生成の他の2案の `features` を使う） |
| FR-08-14 | 選んだ計画は、チェックインが変わっても自動では作り直さない |

generate の手順：

```text
1. session_id のセッションが自分のもので、state が READY_FOR_PLANNING か PLAN_PROPOSED → それ以外は 409
2. PlanningContext を作る（8.3。style = null）
3. generatePlans(context)
     { ok: false } → 422 INFEASIBLE。message = reason ＋「（" + required_changes を「／」でつないだもの + "）」
4. generation_id・3案の id・全項目の id を UUID で作る（10.2）。`locked_items` から写した項目は `carried = true`、それ以外は false
5. save_generation(session_id, plans, items)（4.4）
6. candidates（ScheduleCandidateSchema。id = weekly_plans.id）を返す
```

`label` は `lib/labels.ts` の表示名（集中プラン／バランスプラン／ゆとりプラン）。

### 11.2 今日のタイムライン（F-10）

| ID | 要件 |
|---|---|
| FR-10-1 | `/today` は `GET /api/clock` の日付で `GET /api/calendar/day` を呼ぶ（14.2） |
| FR-10-2 | 項目は `start_at` の昇順で返す |
| FR-10-3 | 詳細シートに `reason` を出す（モックのまま） |
| FR-10-4 | 有効な計画がない日は `has_plan: false`（固定予定と締切だけ）。画面は「この日の計画はまだありません」と「目的地を相談する」ボタン（→ `/interview`）を出す（14.2） |
| FR-10-5 | **翌週の計画の作り方**：MVP では、翌週になったら `/today` の「目的地を相談する」からヒアリングをやり直す（新しい目標として確定 → スケジュール作成）。ヒアリングなしで翌週分だけ作る入口は作らない（17.1 #10） |

### 11.3 カレンダー（F-11。`lib/server/calendar.ts`）

**表示用に計算する値**（DB には保存しない）：有効な計画の項目のうち、`end_at ≤ now` のものは `locked: true`、そのうち `kind: task` のものは `status: "completed"` として返す。`start_at < now < end_at` のもの（進行中）は、タスク・固定予定・移動・睡眠なら `locked: true`、**自由時間・バッファなら `locked: false`**（v1.5。まだ使い方を変えられる時間なので。12.2 で now で2つに切る）。

| API | 組み立て |
|---|---|
| `calendar/day?date=` | date が有効な計画の週に入る → その日の `daily_plan_items`（`has_plan: true`）。それ以外 → その日に展開した固定予定だけ（毎週の予定＋その日の単発の予定。睡眠・移動は出さない。モックと同じ。`has_plan: false`） |
| `calendar/week?start=` | start を含む週の月曜から7日分の `calendar/day` |
| `calendar/month?month=` | その月の全日。各日の `has_plan`、`kinds`（task → task、固定予定の class → class、work → work、social・family → social。出た順に最大3つ）、`deadlines`、`task_hours` |

- `deadlines`：完了していないタスクで、締切の日付がその日のもの
- 形式が不正な `date`・`start`・`month` は400
- `/calendar` の月表示は、どの月でもデータを返す（モックの「2026年10月以外は空」はなくなる）

### 11.4 受け入れテスト

- [ ] generate 後、`weekly_plans` に candidate が3件・同じ generation_id、セッションが PLAN_PROPOSED
- [ ] もう一度 generate すると、前の3案は discarded、新しい3案が candidate
- [ ] select 後、有効な計画は1件で、同じ生成の他の2案は discarded
- [ ] 計画を選んだ後の `/today`（7:00）は、10/5 の計画を開始時刻順に表示する
- [ ] デモ時刻を18:00にすると、13:00〜14:30 のタスクが完了（チェック付き）で表示される
- [ ] 計画のない週のカレンダーは固定予定だけ（移動・睡眠なし）

## 12. 再計画（F-12）優先度A（Demo Path に含む）

### 12.1 機能要件

| ID | 要件 |
|---|---|
| FR-12-1 | `POST /api/plans/replan`（`{ date, text }`）：`text` から意図（`ReplanningIntent`）だけを取り出し、配置は Engine が行う |
| FR-12-2 | 対象は**今日だけ**（**補正 C-12**）。`date` が `getNow()` の日付でなければ `{ supported: false, message: "今日の予定だけ変更できます。" }` |
| FR-12-3 | 対応する意図：`state_change`（疲れた）、`new_fixed_event`（予定が入った）、`task_change`（postpone / skip / shorten）。`preference_change` と判別できない発言は `{ supported: false, message }`（12.3.3） |
| FR-12-4 | `now` より前に終わった項目・`now` を含む項目・完了した項目は変えない |
| FR-12-5 | 固定予定・睡眠・移動・締切・目標の週合計は変えない（ただし `new_fixed_event` は固定予定を1件足す） |
| FR-12-6 | 結果は `ReplanProposal`（モックと同じ形）。成立しない場合は `{ supported: false, message }`（**422 にしない**。2.2） |
| FR-12-7 | 提案は `replan_proposals` に保存し、`accept` まで計画を変えない |
| FR-12-8 | `POST /api/plans/replan/accept`（`{ proposal_id }`）：`apply_replan` で反映し、その日の `DayView` を返す。古い提案は409 `PROPOSAL_EXPIRED` |
| FR-12-9 | 利用者の意思による変更を否定的に書かない（要件定義 6.12.5。13章の文言） |

### 12.2 処理の流れ（API：`app/api/plans/replan/route.ts`）

```text
1. date ≠ 今日 → { supported: false }（FR-12-2）
2. 有効な計画がない、または week_start が今週でない → 409（「先にプランを選んでください」）
3. 意図を取り出す（12.3）。unknown・preference_change → { supported: false }
4. new_fixed_events を今日の固定予定に変換する（12.3.1）。今日の固定予定・睡眠と重なる予定があれば
   { supported: false, message: "{重なる予定のタイトル}（{開始}〜{終了}）と重なるため、この予定は入れられません。時刻を変えて教えてください。" }（**補正 C-22**）
5. Before を作る：有効な計画の7日分。今日の項目には 11.3 の表示用の計算（locked・completed）をかける
6. PlanningContext を作る：style = 有効な計画の style、fixed_events に 4 の予定を足す、
   locked_items = Before の今日の locked な項目
   **now をまたぐ自由時間・バッファ（locked: false）は、Engine の作業用のコピーで now で2つに切り、前半 [start_at, now) を locked の項目（同じ kind）として locked_items に入れ、後半 [now, end_at) は空きとして扱う**（Before の項目そのものは切らない。id もそのまま）
   state_change なら、その日の daily_checkins の fatigue を更新する（チェックインは計画ではないので accept を待たない）
7. replan(context, beforeDays, intent)
     { ok: false } → { supported: false, message: reason ＋ required_changes }
8. updated_days の全項目に新しい UUID を振り、proposal の after と、changes・other_day_changes の after の項目も同じ対応で置き換える。
   **before と changes[].before の項目は元の id のまま**（画面が before の id で「変更なし」を数えるため）。今日の locked な項目・carried の値は Before のまま引き継ぐ
9. replan_proposals に保存（base_version = 有効な計画の version、expires_at = 実際の現在時刻 + 30分）
10. ReplanProposal（proposal_id = 保存した行の id）を返す
```

### 12.3 意図の取り出し

#### 12.3.1 LLM（`lib/llm/replan-intent.ts`。`LLM_MODE=on`）

- 入力：発言、今日の日付と `now`、今日の `now` 以降のタスク項目（task_id・タイトル・時刻）
- 出力：`ReplanIntentLlmSchema`（3.3）
- 変換・検証（サーバー）：
  - `task_changes[].task_id` が入力の一覧にない → その要素を捨てる
  - `new_fixed_events`：`start_time`・`end_time` を今日の日時にする。`end_time` が null → 開始＋60分（**補正 C-10**。要約で「終わりの時刻が分からないため、1時間で仮置きしました。」と伝える）。`title` が null →「予定」。`category: "other"`、`location_id: null`、`recurrence: null`、`id`：UUID。開始が `now` より前・開始 ≥ 終了・終了が24:00を超える → 捨てる
  - 捨てた結果、その type の中身が空 → `unknown` として扱う
- 失敗（タイムアウト・形が違う）→ 12.3.2 のキーワードで取り出す

#### 12.3.2 キーワード（`lib/llm/replan-keywords.ts`。`LLM_MODE=off` と失敗時）

上から順に調べ、最初に当てはまったものを使う。

| 条件（正規表現） | 意図 |
|---|---|
| `/疲れ\|つかれ\|しんど\|だる\|眠い\|ねむい/` | `state_change`、`fatigue: "high"` |
| `/(\d{1,2})時(半)?から/` かつ `/予定\|用事\|約束\|バイト\|会議/` | `new_fixed_event`。開始＝その時刻（半なら :30）。`/(\d{1,2})時(半)?まで/` があれば終了、なければ C-10。`/(\d+)時間/` があれば 開始＋その時間 |
| `/勉強したくない\|もう(やりたくない\|無理)/` | `task_change`：今日の `now` 以降のタスク項目の task_id すべてを `postpone` |
| `/明日に(回\|まわ)/` かつ、今日の `now` 以降のタスクのタイトルが発言に含まれる | `task_change`：そのタスクを `postpone` |
| それ以外 | `unknown` |

#### 12.3.3 対応していないときの返事

`{ supported: false, message: "ごめんなさい、この内容はまだ計画に反映できません。『今日は疲れた』『20時から1時間予定が入った』『今日はもう勉強したくない』のように教えてください。" }`

### 12.4 意図ごとの処理（`lib/planning/replan.ts`）

共通：今日の `now` 以降だけを作り直し、明日以降は「自由時間の一部をタスクに置き換える」ことだけを行う（変更を最小にする）。再計画は探索（ビーム）を使わずルールで行う。適合度は P4の `Fit`、バッファは15分。

疲労時の値（`config.ts`）：

| 名前 | 値 | 意味 |
|---|---|---|
| `tired_rest_minutes` | 30 | 最初の休憩 |
| `tired_light_max_minutes` | 20 | 目標の軽作業版の最大 |
| `tired_light_min_minutes` | 10 | 目標の軽作業版の最小（**この場合だけ、付録P の `lengths` の最小30分・DurationFit の「分割可で L < 30 → 0」の例外**） |
| `tired_light_buffer_min_minutes` | 10 | 軽作業版の後ろのバッファの最小（次が固定予定・移動なら 15 未満でよい。BUFFER_SHORTAGE はタスクとタスクの間だけの検査のため） |

**A. state_change（fatigue: high または medium）**…Demo Path。**medium も high と同じ処理にする**（m_i は fatigue: high として計算する。チェックインには言われた値をそのまま保存する）。`fatigue` が low・null の state_change は 12.3.3 の返事にする

```text
今日（now 以降）：
  a. 高集中タスク（fatigue: high として計算した Fit が 0 になるもの。P4.1）の項目を外す。外した項目の直後のバッファも外す
  （空き：now 以降で、固定予定・移動・睡眠・locked な項目・d で残す項目のない時間。locked: false の自由時間・バッファは空きとして作り直す）
  b. now 以降の最初の空きの先頭に、休憩（free、30分、REST）を置く
  c. 外した中に目標タスクがあれば、b の後ろに目標の軽作業版を置く
       L = min(外した目標の分, 20, その空きの work_end − 現在位置 − 10) を5分単位に切り下げ
       L ≥ 10 なら置き（TIRED_LIGHT）、後ろに残りの時間をバッファ（10分以上）として置く
       L < 10 なら置かず、次の空きで同じことをする（今日の中で見つからなければ置かない）
  d. 外さなかった項目（高集中でないタスクと、その前後のバッファ）はそのまま残す
  e. それ以外の今日の空きは、すべて自由時間にする（隣り合う自由時間は1つにまとめる）
明日以降（外した分の行き先）：
  f. 締切タスク：明日〜min(締切の前日, 日曜) の日の自由時間に、日付の早い順で置く
       置き方：自由時間の先頭に（直前がタスクならバッファを置いてから）タスク、後ろにバッファ。残りは自由時間
       Fit > 0（明日以降は状態なしとして計算）、その日のタスク合計 ≤ T_comf（240。締切の最終日だけは daily_work_limit_minutes まで）
       締切が来週以降で今週に置けない → 今週からは外す（要約で「来週に回します」と伝える）
       締切が今週で置けない → 成立しない（T_comf の代わりに daily_work_limit_minutes まで使っても置けなければ infeasible）
  g. 目標タスクの不足分（外した目標の分 − L）：明日〜日曜の日を「自由時間の合計が多い順」に見て、
       その日に目標タスクの項目があり、その直後が「バッファ → 自由時間」なら、目標タスクを延長し、バッファを後ろにずらす（自由時間が減る）
       そうでなければ、その日の自由時間に新しく置く（f と同じ置き方）
       日曜まで見ても置けない → 成立しない
```

デモ（バランスプラン、10/5 18:00）で期待する結果：月曜の 18:00 以降にある TOEIC リスニング演習（目標の時間帯 evening のため、18:00〜19:00 か夕食後に置かれている。P14のテスト）と、18:00 以降のほかの高集中タスクが外れ、18:00〜18:30 休憩、18:30〜18:50 TOEIC 単語（20分）、18:50〜19:00 バッファ。夕食はそのまま、夕食後は自由時間。リスニングの不足40分（と、外したほかのタスク）は明日以降に移る（行き先の日は Engine の計算による）。18:00 より前に終わった項目は locked・completed で変わらない。

**B. new_fixed_event**：予定（場所は null なので移動は増えない）を今日に足す → 予定と重なる項目（タスク・バッファ・自由時間）だけを外す。自由時間は予定の前後に分かれて残る → 外したタスクは、今日の now 以降の自由時間（60分以上）に置けなければ f・g の行き先へ → 今日の他の項目は動かさない。

**C. task_change**

| action | 処理 |
|---|---|
| postpone | 今日の該当タスクの項目を外し、f（締切タスク）・g（目標タスク）・任意タスクは g と同じ置き方で明日以降へ。外した場所は自由時間 |
| skip | 締切タスク：postpone と同じ（締切を守るため）。目標タスク：g。任意タスク：今週から外す |
| shorten | 今日の該当項目を半分（5分単位に切り下げ。30分未満になるなら外す）にし、残りは postpone と同じ |

### 12.5 変更点（`lib/planning/diff.ts`）

変更点は、Engine が 12.4 の操作をしながら記録する（Before と After を後から比べて推測しない）。

| 操作 | changes（今日） | other_day_changes |
|---|---|---|
| 高集中タスクを外し、その時間に休憩・軽作業版を置いた | `replaced`（before＝外した項目、after＝その時間帯の After の項目、reason：`TIRED_LIGHT`） | 残りを別の日に置いたら `moved`（before＝外した項目、after＝別の日の項目、moved_to_date、reason：`GOAL_CARRYOVER` か `TIRED_MOVED`） |
| タスクを外し、今日の中では置き換えなかった | `moved`（after＝[]、moved_to_date＝行き先の日、reason：`TIRED_MOVED`・`USER_POSTPONED` など） | `moved`（after＝行き先の日の項目） |
| タスクを外し、今週には置かない | `removed`（reason：`NEXT_WEEK` か `USER_SKIPPED`） | なし |
| タスクに付いていたバッファを外した | `removed`（reason：`BUFFER_MERGED`） | なし |
| 自由時間が広がった・まとまった | `replaced`（before＝元の自由時間、after＝新しい自由時間、reason：`FREE_EXTENDED`） | なし |
| now をまたぐ自由時間・バッファを切って作り直した | `replaced`（before＝元の項目、after＝前半＋その時間帯の新しい項目、reason：後半に休憩を置いたら `REST`、そうでなければ `FREE_EXTENDED`） | なし |
| 予定を足した | `added`（after＝予定、reason：`FIXED_EVENT_ADDED`） | なし |
| 短くした | `shortened`（after＝短くした項目、reason：`USER_SHORTENED`） | 残りを置いたら `moved` |
| 既存のタスクを延長した（g） | なし | `moved`（before＝外した項目、after＝延長後の項目、moved_to_date） |

- 変更のない項目は changes に入れない（画面は「変更なし ◯件」を Before の件数 − 変更件数で出す）
- 並び順：changes は before（なければ after）の開始時刻順。other_day_changes は日付順
- `summary_message`：13.4

### 12.6 提案の確定（accept）

- `apply_replan(proposal_id)`（4.4）。`PROPOSAL_EXPIRED` → 409（「時間がたったため、この提案は使えません。もう一度伝えてください。」）
- 返すもの：確定後の今日の `DayView`（11.3 の計算をかけたもの）
- 「やめておく」は API を呼ばない（提案は30分で無効になる）

### 12.7 受け入れテスト

Engine（`lib/planning/__tests__/replan.test.ts`。バランスプランを生成し、now = 10/5 18:00、`state_change` fatigue high）：

- [ ] Validator（mode = replan）の errors が0件（`LOCKED_ITEM_CHANGED` なし）
- [ ] 今日の 18:00 以降に高集中タスク（リスニング・ES）がない
- [ ] 18:00〜18:30 休憩、18:30〜18:50 単語、18:50〜19:00 バッファ
- [ ] 今週の目標タスクの合計が360分のまま
- [ ] ES の項目がすべて締切（10/12）より前の日
- [ ] 夕食の項目が変わっていない
- [ ] changes に replaced（リスニング → 休憩・単語・バッファ）がある。other_day_changes に、リスニングの残り40分の moved がある
- [ ] fatigue: medium でも同じ結果になる
- [ ] **now をまたぐ自由時間**：TOEIC を夕食後（19:45〜20:45）に置き、17:00〜19:00 を自由時間にした Before でも、18:00〜18:30 休憩、18:30〜18:50 単語、18:50〜19:00 バッファになる。17:00〜18:00 の自由時間は残り、`LOCKED_ITEM_CHANGED` が出ない

API（手動）：

- [ ] accept 前の `/today` は変更前のまま。accept 後の `/today` とカレンダーに反映される
- [ ] 同じ提案をもう一度 accept すると409
- [ ] 「20時から1時間予定が入った」で 20:00〜21:00 に予定が足され、19:45〜24:00 の自由時間が前後に分かれる
- [ ] 「19時から1時間予定が入った」は、夕食（19:00〜19:45）と重なるため入れられないという返事になる
- [ ] `LLM_MODE=off` でも「今日は疲れた」で同じ結果になる

## 13. 判断理由の説明（F-13）優先度S

### 13.1 機能要件

| ID | 要件 |
|---|---|
| FR-13-1 | Engine は、置いたタスク・バッファ・休憩に理由コードを付ける。説明の根拠はこのコードだけ |
| FR-13-2 | 画面に出す `reason`・`explanation`・変更の `reason`・`summary_message` は、すべてテンプレートで作る（LLM は使わない。**補正 C-16**） |

### 13.2 理由コードとテンプレート（`lib/planning/reasons.ts`）

`{M/D}` は「10/9」、`{曜日}` は「水曜」、`{時間帯}` は開始時刻から 朝（〜9:59）／午前（10:00〜11:59）／午後（12:00〜16:59）／夕方（17:00〜18:59）／夜（19:00〜）。

| reason_code | 付ける場所 | テンプレート |
|---|---|---|
| `DEADLINE_EARLY` | 締切タスク（集中プラン） | 締切（{M/D}）より早めに終わらせるため、{時間帯}に進めます |
| `DEADLINE_NEAR` | 締切タスク（その日が完了目標日） | 締切（{M/D}）が近いため、ここで仕上げます |
| `DEADLINE_STEADY` | 締切タスク（それ以外） | 締切（{M/D}）に向けて、少しずつ進めます |
| `GOAL_ROUTINE` | 目標タスク | 週{N}時間の{目標名}のため、{時間帯}に入れました |
| `OPTIONAL_EXTRA` | 任意タスク | 時間に余裕があるため、{タスク名}を進めます |
| `LIGHT_TASK` | 軽作業（集中プラン） | 短い時間で終わる{タスク名}を片付けます |
| `LIGHT_IN_BUFFER` | 候補付きのバッファ | 短い時間でできる{タスク名}を候補にしました |
| `REST` | 再計画の休憩 | まずは休憩をとって、疲れを回復します |
| `TIRED_LIGHT` | 再計画：置き換え | 疲れているため、集中力が必要な{元のタスク}を、短時間でできる{新しいタスク}に切り替えました |
| `TIRED_MOVED` | 再計画：締切タスクを他の日へ | 集中力が必要な{タスク名}は今日は避けました。締切（{M/D}）には間に合います |
| `GOAL_CARRYOVER` | 再計画：目標を他の日へ | 週{N}時間の目標を保つため、{曜日}に振り替えました |
| `BUFFER_MERGED` | 再計画：バッファを外した | 作業がなくなったため、自由時間にまとめました |
| `FREE_EXTENDED` | 再計画：自由時間を広げた | ゆっくり休めるようにしました |
| `FIXED_EVENT_ADDED` | 再計画：予定の追加 | {時刻}からの予定を入れました |
| `USER_POSTPONED` | 再計画：後回し | {タスク名}を{曜日}に回しました |
| `USER_SKIPPED` | 再計画：今週はやめる | {タスク名}は今週はお休みにしました |
| `USER_SHORTENED` | 再計画：短縮 | {タスク名}を{N}分に短くしました |
| `NEXT_WEEK` | 再計画：今週に入らない締切タスク | {タスク名}は締切（{M/D}）に間に合うよう、来週に回します |

バッファ（候補なし）の `reason` は null。

### 13.3 説明文（`explanation`）

| 案 | テンプレート |
|---|---|
| intensive | 締切のある{締切タスク名を「と」でつなぐ}を早めに終わらせ{任意タスクがあれば「、{任意タスク名}も進める」}プランです。空き時間は少なめです。 |
| balanced | 締切に余裕を持って間に合わせつつ、毎日自由時間を残すプランです。 |
| relaxed | 締切に間に合う範囲でゆっくり進め、休む時間とバッファを多めにとるプランです。 |

締切タスクがない週の intensive：「目標の時間をしっかり確保し{…}、空き時間は少なめのプランです。」

### 13.4 要約（`summary_message`）

| 意図 | テンプレート |
|---|---|
| state_change | お疲れさまです。今夜は軽めにして、{移したもの（「ESは水曜」「TOEICの残り40分は木曜」を「、」でつなぐ）}に回しました。{変えなかった固定予定の代表（今日の now 以降の最初の固定予定）}はそのままで、週{N}時間の目標{締切タスクがあれば「と{タスク名}の締切」}も守れます。 |
| new_fixed_event | {時刻}からの予定を入れ、{移したもの}に移しました。{C-10 の一文} |
| task_change | {移した・短くしたものの説明}。{締切タスクがあれば「締切（{M/D}）には間に合います。」} |

移したものがない場合は「{…}に回しました」の部分を省く。
