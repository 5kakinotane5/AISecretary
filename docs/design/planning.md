# 設計書：Planning Engine（10章・付録P）

> 設計書（`docs/design/`）の一部。目次・章とファイルの対応は [README.md](README.md)。章番号は設計書全体で共通。

## 10. Planning Engine・バッファ（F-08・F-09）優先度S

### 10.1 機能要件

| ID | 要件 |
|---|---|
| FR-08-1 | `PlanningContext` から、今週（月〜日）の計画を3案（intensive / balanced / relaxed）作る |
| FR-08-2 | 同じ `PlanningContext` からは必ず同じ結果を返す（乱数・`Date.now()`・環境変数を使わない。並べ替えは同点なら id の昇順） |
| FR-08-3 | `now` より前に新しく項目を置かない。`now` より前は、骨組み（睡眠・固定予定・移動）と `locked_items` のタスク・バッファ・自由時間をそのまま入れる |
| FR-08-4 | 3案とも、目標の残り R（8.2）を**全量**配置する（目標を減らさない） |
| FR-08-5 | 3案は、実行可能な計画の中の Pareto 解から、3つの方向（集中・バランス・ゆとり）に近く、互いに十分違うものを選ぶ（P7〜P8）。違いは配置・タスク量・バッファ・自由時間に出る |
| FR-08-6 | 3案すべてが Validator（10.11）の errors 0件 |
| FR-08-7 | 各案に比較用の集計（`PlanSummary`）と説明文を付ける（10.12・13章） |
| FR-08-8 | 成立しない場合は回復手順（10.13）を試し、それでも無理なら `{ ok: false, infeasible }` を返す |
| FR-08-9 | 3案の生成は3秒以内（P13） |
| FR-08-10 | すべての項目に理由コード（`reason_code`）と理由の文章（`reason`）を付ける（固定予定・睡眠・移動・自由時間は両方 null） |
| FR-09-1 | 空き時間をすべてタスクで埋めない。同じ空きの中のタスクとタスクの間にはバッファを置き、残りは自由時間にする |
| FR-09-2 | バッファに軽作業を「候補」として付けられる（`suggested_task_id`）。候補は作業時間に数えない |
| FR-09-3 | 疲労度が高い・集中できない日は、高集中タスクを避ける（P4） |

### 10.2 Engine の関数と出力

| 関数 | 入力 | 出力 |
|---|---|---|
| `generatePlans(context)` | `PlanningContext`（style は null） | `EngineGenerateResult`（3.1） |
| `replan(context, beforeDays, intent)` | `PlanningContext`（style あり）、有効な計画の7日分（`DayPlan[]`）、`ReplanningIntent` | `EngineReplanResult`（3.1） |
| `validatePlan(context, days, mode)` | mode：`"generate"`・`"replan"`・`"stored"` | `ValidationResult` |
| `computeGoalCandidateHours(input)` | `{ category, deadline, today, explicit_hours_per_week, frequency_per_week, main_minutes, weekly_free_minutes }` | `{ intensive, balanced, paced }`（7.2） |
| `computeWeeklyFreeMinutes(context)` | `PlanningContext`（goals・tasks は空でよい） | now〜日曜の空き（`work_end` まで）の合計分（7.2.2 の上限に使う） |

- 項目の `id`：Engine が作る項目は `tmp_{style}_{date}_{連番}`、`locked_items` から入れた項目は元の id。**API は保存するときに全項目の id を新しい UUID に振り直す**（DB の行は案ごとに別物なので）
- `reason_code` は `PlannedItemSchema` で運ぶ。API が画面に返すときは `ScheduleCandidateSchema.parse()` で自然に落ち、DB には `reason_code` 列として保存する
- 理由の文章（`reason`）・説明文（`explanation`）・再計画の変更理由と要約も Engine（`reasons.ts`）が作る。API は文章を作らない

### 10.3 処理の流れ

| # | 要件定義 6.8.2 | ファイル | 内容 |
|---|---|---|---|
| ① | Validate | `generate.ts` | `PlanningContextSchema.parse` |
| ② | Fixed Events | `skeleton.ts` | 今週の固定予定を日ごとに並べる |
| ③ | Sleep | `skeleton.ts` | 睡眠を置く |
| ④ | Travel | `skeleton.ts` | 移動を置く（10.4） |
| ⑤ | Free Slots | `slots.ts` | 空きを作る（10.5） |
| ⑥ | Hard Constraints | `skeleton.ts` | 骨組みで成立しない（移動が入らない、移動時間表にない）なら infeasible |
| ⑦ | Task Priority | `priority.ts` | 10.6 |
| ⑧ | Task × Slot Fit | `fit.ts` | P4 |
| ⑨ | Buffer | `day-beam.ts` | P5.3（タスク間のバッファ・先頭のバッファ）、10.3（候補） |
| ⑩ | Candidate Generation | `allocate.ts`・`day-beam.ts` | P3・P5（割り振り案 × 方向 × 日ごとのビーム） |
| ⑪ | Score | `objectives.ts`・`select.ts`・`summarize.ts` | P6〜P8（F(S)・Pareto・3方向）、10.12（集計） |
| ⑫ | Validator | `validate.ts` | 10.11（P7.1 の実行可能集合の判定に使う） |
| ⑬ | Return | `generate.ts` | 3案（intensive・balanced・relaxed の順） |

①〜⑦は共通、⑧以降は 付録P のとおり。時刻はすべて**5分単位**（`now` は5分単位に切り上げて使う）。

### 10.4 骨組み（睡眠・固定予定・移動）

1日（0:00〜24:00）ごとに作る。骨組みの項目は `locked: true`。

1. **睡眠**：`sleep_start`〜`sleep_end`（title「睡眠」、場所は自宅）。日をまたぐ設定（例 23:30〜7:00）は、その日の 0:00〜7:00 と 23:30〜24:00 の2つに分ける
2. **固定予定**：今週に展開した固定予定（title・category・場所はそのまま）
3. **移動**：その日の場所の並び（自宅 → 固定予定の場所 … → 自宅）で、場所が変わる箇所に移動を置く
   - 長さ：移動時間表の `minutes`（前後の余裕は足さない。要件定義 15章 #3）
   - title：「移動 {出発地の名前}→{到着地の名前}」、`travel`：`{ from_location_id, to_location_id, mode }`
   - 位置（**補正 C-6**）：出発地が自宅なら次の予定の**直前**（ぎりぎりまで自宅にいる）。出発地が自宅以外なら前の予定の**直後**（早めに次の場所へ移る）
   - 1日の最初の予定が自宅以外なら自宅からの移動を、最後の予定が自宅以外なら自宅への移動を入れる
   - 同じ場所の予定が続くときは移動を入れない（途中で帰宅しない）
   - 隙間が移動時間より短い → infeasible（「{予定A}と{予定B}の間の移動時間が足りません」）

mock-spec 5.6 の骨組みとほぼ同じになる。違い：月曜は昼食（大学）の直後に帰宅するため、大学での作業時間はなくなる（13:00〜13:50 が移動）。

### 10.5 空き（FreeSlot）

骨組み（と、`now` より前の `locked_items`）の隙間のうち、次のもの。

| 属性 | 内容 |
|---|---|
| `start` | 隙間の開始。`now`（5分切り上げ）より前なら `now` |
| `end` | 隙間の終わり |
| `work_end` | タスク・バッファを置いてよい終わり＝ min(`end`, `sleep_start` − 30分)。**就寝前30分は自由時間にする**（タスクは置かない） |
| `location_id` | その時間にいる場所（直前の項目の場所。移動の後なら到着地） |
| 最小の長さ | 15分未満の隙間は空きにせず、項目を置かない（何もない時間として表示される） |

### 10.6 優先度 W（`priority.ts`）

数学モデル（4章）と要件定義 7.4 の式を使う。

```text
W_i = 0.35·P_i + 0.35·D_i + 0.10·U_i + 0.20·W_i^user
```

| 項目 | 計算 |
|---|---|
| レベルの数値 | low = 0.3、medium = 0.6、high = 1.0 |
| P_i | `importance` の数値 |
| D_i（締切タスク） | min(1, 残り[時間] ÷ 締切までの日数)。日数 = max(1, 締切の日付 − 今日の日付) |
| D_i（目標タスク） | 0.6 × R ÷ W（W が0なら0） |
| D_i（その他） | 0 |
| U_i | `in_progress` = 1.0、`not_started` = 0.5 |
| W_i^user | 今日のチェックインの `want_task_ids` に含まれる = 1、`avoid_task_ids` に含まれる = −1、それ以外 = 0（今日以外は0） |

W は、同じ日・同じ種類のタスクの中で**置く順番**と、任意タスクをどれから入れるかにだけ使う。同点は id の昇順。

### 10.7〜10.10 適合度・割り振り・配置・パラメータ

**付録P（`planning.md`） に置き換えた**（v1.3）。対応：

| 旧 | 付録P |
|---|---|
| 10.7 適合度 Fit | P4（ゲート＋重みつきの和） |
| 10.8 今週の必要量と日への割り振り | P3（割り振り案。ρ・κ・目標の日の順番を複数通り） |
| 10.9 配置（時間帯の希望の確保を含む） | P5（日ごとのビーム探索。時間帯の希望は Fit のゲート） |
| 10.10 3案のパラメータ | P12（設定値）、P8.1（方向ベクトル） |

再計画（12.4）は引き続きルールで行い、適合度は P4の関数を使う。

### 10.11 Validator（`validate.ts`）

3案・再計画の After・保存済みの計画（`/api/mock/check`）で同じ関数を使う。`mode` によって一部の検査を行わない。

| code | 区分 | 条件 | generate | replan | stored |
|---|---|---|---|---|---|
| `START_AFTER_END` | error | `start_at >= end_at` | ○ | ○ | ○ |
| `ITEM_OVERLAP` | error | 同じ日の項目が重なる（隣接は可） | ○ | ○ | ○ |
| `FIXED_EVENT_OVERLAP` | error | 固定予定以外が固定予定の時間帯に入る。または固定予定の項目が、`context.fixed_events`（再計画で追加する予定を含む）と時刻・場所で一致しない | ○ | ○ | ○ |
| `SLEEP_OVERLAP` | error | 睡眠の時間帯に睡眠以外の項目がある | ○ | ○ | ○ |
| `TRAVEL_MISSING` | error | `travel` 以外で `location_id` を持つ項目を時刻順に並べたとき、場所が変わる箇所に、移動時間表どおりの長さの `travel` がない | ○ | ○ | ○ |
| `DEADLINE_VIOLATION` | error | タスク項目の `end_at` がそのタスクの `deadline_at` より後 | ○ | ○ | ○ |
| `BUFFER_SHORTAGE` | error | タスクとタスクが（移動・固定予定をはさまずに）続くとき、間のバッファが `min_buffer_minutes` 未満 | ○ | ○ | ○ |
| `BUFFER_SHORTAGE` | warning | 1日の「バッファ＋自由時間」が `min_daily_buffer_minutes` 未満（**補正 C-8**） | ○ | ○ | ○ |
| `DAILY_LIMIT_EXCEEDED` | error | 1日のタスク合計が `daily_work_limit_minutes` を超える | ○ | ○ | ○ |
| `INVALID_REFERENCE` | error | `task_id`・`location_id`・`fixed_event_id`・`suggested_task_id` が context にない（`task_id` は、実施済みで context から外れたタスクなら可） | ○ | ○ | ○ |
| `GOAL_HOURS_MISMATCH` | error | generate・replan：`end_at > now` の目標タスクの項目の合計 ≠ R。stored：計画全体の目標タスクの合計 ≠ W | ○ | ○ | ○ |
| `PAST_PLACEMENT` | error | `locked: false` の項目の `start_at` が `now` より前 | ○ | ○ | － |
| `LOCKED_ITEM_CHANGED` | error | 再計画の Before で `locked: true` または `status: completed` の項目が、After で時刻・内容が変わった／なくなった | － | ○ | － |
| `CANDIDATES_TOO_SIMILAR` | warning | 3案のどれか2案の統合距離 D が D_min 未満（P8.2。stored では保存した `features` と項目から計算） | ○ | － | ○ |

**補正 C-8**：要件定義 6.8.3 の「バッファが最低量以上ある」は、予定間の最低量（15分）を絶対条件とし、1日合計（60分）は自由時間も含めた警告とする（mock-spec 6章と同じ）。

### 10.12 集計・評価（`summarize.ts`）

**集計（`PlanSummary`）**：モックの `lib/mock/summarize.ts` と同じ計算（7日分の項目から）。目標タスクは context の目標で判定する。

- `goal_hours`：目標タスクの項目の合計
- `deadline_task_count`：締切タスクの項目を1つ以上含むタスクの数
- **`overload`（補正 C-9）**：いずれかの日のタスク合計が `daily_work_limit_minutes × 0.8`（デモでは288分）を超えれば true（モックの「上限を超える」は Validator のエラーと同じ条件で常に false になるため）。集中プランで true になりやすい（実際の値は実装結果で確認する）
- `explanation`：13.3

**目的ベクトル F(S)**：P6（7つの目的）。`features` として出力し、`weekly_plans.features` に保存する。

### 10.13 成立しない場合（`generate.ts`・`recover.ts`）

3案の選び方と差の確認（`CANDIDATES_TOO_SIMILAR`）は P8。成立しない場合の手順はP10.4（κ = 0・バッファ15分で探索し直す）。再計画で成立しない場合は 12.4。

- 睡眠・固定予定・締切・目標・移動時間は回復の中でも変えない
- `reason`：「{タスク名}を締切（{M/D}）までに終えるには、空き時間が{N}分足りません。」または「今週の{目標名}の{N}分を置く空き時間が足りません。」
- `required_changes`（最大3件）：「{タスク名}の所要時間を見直す」「{最もタスクの少ない日}の予定を調整する」「目標の時間を見直す（設定の『新しい目的地を相談する』から）」から該当するもの

### 10.14 受け入れテスト（`lib/planning/__tests__/`）

`fixtures.ts`：`mocks/` から PlanningContext を作る（now = 2026-10-05T07:00:00+09:00、目標 G1（時間帯は平日 evening）、目標タスク2件、W = R = 360、チェックインなし、locked_items なし）。

3案の生成のテストは P14。設計書の範囲（骨組み・空き・優先度・Validator・集計）のテスト：

- [ ] 骨組み：月曜の移動が 8:10〜9:00（自宅→大学、直前）と 13:00〜13:50（大学→自宅、直後）
- [ ] 空き：月曜の空きが 13:50〜19:00 と 19:45〜24:00（work_end は 23:30）
- [ ] 優先度：W（レポート）> W（ES）> W（企業研究）
- [ ] Validator：モックの3案（`mocks/plans/`）を mode = stored で検査すると errors が0件（モックの検査と同じ結果）
- [ ] 集計：モックのバランスプランの `summarize` の結果が、`lib/mock/summarize.ts` と同じ（overload だけ C-9 で変わりうる）

---

# 付録P：3案の生成（数学モデルの実装仕様）

## P0. この付録について

### P0.1 位置づけ

- 付録P は、元の数学モデル（`AI秘書_PlanningEngine_3候補生成_数学モデル.html`）を **MVP で実装できる形**にした、3案の生成の仕様である
- 骨組み・空き・優先度（10.4〜10.6）、Validator（10.11）、集計（10.12）、理由の文章（13章）、再計画（12章）は、この付録ではなく各章に従う
- 付録P にない判断が必要になったら、17.2「実装中に決めてよいこと」に従う（`config.ts` の数値の調整はしてよい）
- 担当：B（Planning Engine）。ファイルはすべて `lib/planning/` の下

### P0.2 数学モデルからの変更点

元のモデルの考え方（ハード制約と目的の分離、Beam Search → 実行可能集合 → Pareto → 3方向 → 多様性、状態による適応、選択からの学習）は、そのまま実装する。ただし、そのままでは実装できない点・矛盾する点を、次のとおり直した。

| # | 元のモデル | 付録P | 理由 |
|---|---|---|---|
| 1 | 1日の計画 | **1週間**の計画。「週の割り振り案」を作り、日ごとにビーム探索する2段構成（P2） | 要件定義 6.8.1（3案は今週の計画）。週全体を1つのビームで探索すると状態が大きすぎる |
| 2 | 15分のセルごとに「タスクを置く／置かない」 | 空きの中の現在位置で「長さ L のタスクを置く／自由時間にする／この空きを閉じる」を選ぶ**ブロック単位**の行動（P5） | セル単位ではタスクの長さ（90分など）を扱えず、同じタスクを何度も置けてしまう |
| 3 | 1つのスコアで上位K件を残すビーム | 3方向それぞれの重みでビームを回し、さらに割り振り案を複数作る（P2・P5） | 1つのスコアではゆとり型の候補が Pareto の前に消える |
| 4 | Fit は重みつきの和 | 「置いてはいけない」要素（時間帯・疲労・集中）が0なら置かない**ゲート**＋重みつきの和（P4） | 和だけでは「疲れている日に高集中タスクを置かない」を表せない |
| 5 | 目的7つの定義なし、`w_base` は5次元 | 7つすべてを 0〜1 の式で定義（P6）。重みは7次元にそろえる | 方向ベクトルとの距離に意味を持たせるため |
| 6 | 学習した重みの使い道が未定義 | 学習した重み `w_user` は方向ベクトル D_k をずらす（P9） | 学習が候補に反映されるようにする |
| 7 | 説明文は LLM | テンプレート（C-16） | 数値・日付の誤りを防ぐ |
| 8 | 擬似コードは Python | TypeScript（P11） | 技術スタック |

### P0.3 記号

| 記号 | 意味 | 値の出どころ |
|---|---|---|
| now | 計画の基準時刻（5分単位に切り上げ） | `PlanningContext.now` |
| 𝒟 | 計画する日の集合＝今日〜日曜 | |
| L_max | 1日の作業上限 | `preferences.daily_work_limit_minutes`（デモ 360） |
| T_comf | 1日の「無理のない」作業量 | `config.comfortable_task_minutes`（240） |
| B_min | タスクとタスクの間の最小バッファ | `preferences.min_buffer_minutes`（15） |
| W_i | タスク i の優先度 | 10.6 |
| F(S) | 計画 S の目的ベクトル（7次元） | P6 |
| D_k | 方向ベクトル（k = A, B, C） | P8 |

時刻は5分単位（固定予定・移動が5分単位のため）、タスクの長さは **Δt = 15分** の倍数で扱う（元のモデル 8.1）。

---

## P1. 全体の流れ

```text
PlanningContext
  │
  ├─ 段階0 前処理（3案で共通）
  │    骨組み（睡眠・固定予定・移動）→ 空き → 優先度 W_i         … 10.4〜10.6
  │
  ├─ 段階1 週の割り振り案（Allocation）を作る                    … P3
  │    パラメータの組（ρ, κ, 目標の日の順番）ごとに、日ごとの「置く量」を決める（最大18通り）
  │
  ├─ 段階2 日ごとのビーム探索（Day Beam）                         … P5
  │    割り振り案 × 方向（A・B・C）ごとに、月→日の順で1日ずつビーム探索し、1週間の計画を作る（最大54通り）
  │
  ├─ 段階3 実行可能集合                                            … P7
  │    Validator（10.11）で errors 0件のものだけ残す
  │
  ├─ 段階4 目的ベクトル F(S) を計算                                … P6
  │
  ├─ 段階5 Pareto Frontier                                         … P7
  │
  ├─ 段階6 3方向への選択と多様性の確認                             … P8
  │    状態で調整した D_A・D_B・D_C に近く、互いに十分違う3案を選ぶ
  │
  └─ 段階7 出力                                                    … P10
       集中プラン（D_A）・バランスプラン（D_B）・ゆとりプラン（D_C）、集計・説明文・理由
```

元のモデルの最終式との対応：

```text
𝒮₀ = Generate(T, F, s_t)            … 段階1・2（割り振り案 × 方向 × 日ごとのビーム）
𝒮₁ = { S ∈ 𝒮₀ : ハード制約をすべて満たす }  … 段階3
𝒫  = Pareto(𝒮₁)                      … 段階5
(S_A*, S_B*, S_C*) = argmin Σ_k ‖F(S_k) − D_k(s_t)‖₂  （S_k ∈ 𝒫、互いに D(S_i, S_j) ≥ D_min） … 段階6
```

**再計画は付録Pの対象外**：再計画（12章）は「変更を最小にする」ことが要件のため、これまでどおりルールで行う。適合度（P4）は再計画でも同じ関数を使う。

---

## P2. 入力と変数

元のモデル 3章の変数を、`PlanningContext` の項目に対応させる。

### P2.1 利用者の状態 s_t（今日の分）

| 元のモデル | 付録Pでの値 | 出どころ |
|---|---|---|
| Fatigue | `checkin.fatigue`（low / medium / high / null） | 今日のチェックイン |
| Concentration | `checkin.concentration` | 同上 |
| Mood | `checkin.mood` | 同上（MVP では使わない） |
| Motivation・AvailableEnergy | 使わない | 取得手段がないため |

今日以外の日と、チェックインがない日は「状態なし」（すべて null）として扱う。

### P2.2 タスクのベクトル t_i

| 元のモデル | 付録Pでの値 |
|---|---|
| Importance | `importance` |
| CognitiveLoad | `concentration`（目標タスクは medium 以上を「高集中」として扱う。1.5） |
| Duration | `remaining_minutes`・`estimated_minutes` |
| Splittability | `splittable` |
| Interruptibility | `interruptible` |
| DeadlineUrgency | `deadline_at` から計算（W_i の D_i） |
| UserDesire | チェックインの `want_task_ids`・`avoid_task_ids`（W_i の W_i^user） |

### P2.3 タスクの種類

1.5 の用語のとおり、締切タスク・目標タスク・任意タスク・軽作業の4種類。軽作業はバッファの候補にするだけで、探索の対象にしない（P10.3）。

---

## P3. 段階1：週の割り振り案（`allocate.ts`）

### P3.1 割り振り案のパラメータ

割り振り案 a はパラメータの組 (ρ, κ, order) で決まる。

| パラメータ | 意味 | 値の候補 |
|---|---|---|
| ρ | 締切タスクの前倒し度（小さいほど早く終える） | 0.30、0.45、0.85 |
| κ | 任意タスクを今週に入れる割合 | 0、0.35、1.0 |
| order | 目標タスクを割り当てる日の順番 | `early`（今日から日付順）、`free_desc`（空きの多い順） |

3 × 3 × 2 = **18通り**。計算の結果、日ごとの割り振りがまったく同じになった案は1つにまとめる。

### P3.2 日ごとの「置く量」（クォータ）

各割り振り案で、日 d ごとに次のクォータの一覧を作る。

| 種類 | 内容 | 必須か |
|---|---|---|
| 締切クォータ | 締切タスク i を、日 d に q 分 | **必須**（置ききれなければ翌日以降に繰り越す） |
| 目標セッション | 目標タスクを、日 d に長さ m で1回（時間帯の希望つき） | **必須**（同上） |
| 任意クォータ | 任意タスク i を、日 d に最大 q 分 | 任意（置かなくてもよい。置いた分だけ Achievement が上がる） |

計算は次のとおり（「今日」は `now` の日付。round は四捨五入＝`Math.round`、日付の差は日数）。

**締切タスク**

```text
n = 締切の日付 − 今日の日付
完了目標日 = 今日 + round(ρ × n)  … 0 以上 max(0, n − 1) 以下に収める（締切の前日までに終える。n = 0 なら今日）
今週に置く量 A = 完了目標日が日曜以前 → 残り全量
               それ以外 → 残り × (今日〜日曜の日数) ÷ (今日〜完了目標日の日数) を15分単位に切り上げ
対象日数 d = 今日〜min(完了目標日, 日曜) の日数
1回の量 q = A ÷ d を15分単位に切り上げ（高集中タスクは60以上、120以下）
回数 k = ceil(A ÷ q)（k > d なら k = d、q = A ÷ d を15分単位に切り上げ）
置く日 = 対象日のうち位置 round(j × (d − 1) ÷ (k − 1))（j = 0…k−1）。k = 1 なら完了目標日
最後の回は A − q × (k − 1)（端数）
```

デモ（今日 10/5）：ρ = 0.45 のとき、ゼミレポート（180分・10/9締切）は完了目標日が水曜で月・火・水に60分ずつ、ES（120分・10/12締切）は完了目標日が木曜で月・木に60分ずつ。

**目標タスク**（1回分の単位で割り振る）

```text
メインの1回 m = メインの目標タスクの estimated_minutes（TOEIC なら60）
回数 k = floor(R ÷ m)、端数 r = R − k × m
日の順番 = early：今日から日付の早い順
          free_desc：その日の空きの合計（work_end まで）が多い順（同じなら日付の早い順）
k 回を日の順番に1回ずつ割り当てる。k が日数より多ければ、先頭の日からもう1回ずつ
端数 r：r ≥ 30 なら軽作業版（なければメイン）を r 分として、回数の最も少ない日（同じなら日の順番の先頭）に1回
       r < 30 なら、最後に割り当てたメインの1回を r 分長くする
```

**任意タスク**

```text
今週に置く量 = κ × 残り（15分単位に切り下げ）
各日の余裕 = T_comf − その日の必須クォータの合計
余裕の大きい日から（同じなら日付の遅い順）、1日 min(余裕, 120) 分まで割り当てる
```

- 目標セッションには、その日（平日・週末）の時間帯の希望 `band`（`goal_time_bands`。null 可）を付ける
- デモ（R = 360、m = 60）では、order がどちらでも月曜に目標セッションが1回入る（`early` は月〜土、`free_desc` は空きの最も少ない火曜以外）

### P3.3 繰り越し

段階2で、ある日の必須クォータが置ききれなかった場合、残りを次のように繰り越す。

- 締切クォータ：翌日以降、締切の前日（締切が今日なら今日）までの日の最初の日へ
- 目標セッション：翌日へ。日曜でも置けなければ、`band` を null にして日曜にもう一度探索する
- 繰り越す先がない → その「割り振り案 × 方向」は失敗（段階3に進めない）

---

## P4. 適合度 Fit（`fit.ts`）

タスク i を時刻 t から長さ L で置くときの適合度。元のモデル 5章の「特徴量ベクトル × 重み」に、置いてはいけない場合を0にするゲートを加える。

```text
x(i, t, L) = [ DurationFit, TimeOfDayFit, ConcentrationFit, FatigueFit, InterruptFit, SplitFit ]
q(i, t, L) = w_fit · x        … 置き方の良さ（0〜1）
gate(i, t, L) = 0  … DurationFit・TimeOfDayFit・ConcentrationFit・FatigueFit のどれかが 0 のとき
               1  … それ以外
Fit(i, t, L) = gate × q
```

Fit = 0 の置き方は探索しない（ハード制約扱い）。Fit > 0 なら、q が目的 TaskFit（P6）とビームのスコア（P5.4）に入る。

### P4.1 特徴量

| 特徴量 | 値 |
|---|---|
| DurationFit | 分割不可で L ≠ `estimated_minutes` → 0。分割可で L < 30 → 0。それ以外 1 |
| TimeOfDayFit | 目標セッションで、その日の `band` があり、[t, t+L) が band の中に収まらない → 0。高集中タスク：開始が 7:30〜21:59 → 1.0、22:00〜22:59 → 0.5、23:00以降 → 0。その他のタスク：1.0。どのタスクも終わりは `work_end`（10.5）まで（超えれば 0） |
| ConcentrationFit | 今日の `concentration: low` のとき：高集中 → 0、集中力 medium → 0.5、low → 1。それ以外 1 |
| FatigueFit | 今日の `fatigue: high` のとき：高集中 → 0、medium → 0.5、low → 1。`fatigue: medium` のとき：高集中 → 0.6、それ以外 1。それ以外 1 |
| InterruptFit | `interruptible` なら 1。そうでなければ、その空きに L + 30 分以上の余裕があれば 1、なければ 0.5 |
| SplitFit | `splittable` なら 1。そうでなければ L = `estimated_minutes` なので 1（DurationFit で弾かれていない限り） |

`band` の時間：morning 6:00〜12:00、daytime 12:00〜18:00、evening 18:00〜`work_end`。

**締切の最終日の例外**：その日が締切タスクを置ける最後の日（締切の前日、締切が今日なら今日）なら、そのタスクの ConcentrationFit・FatigueFit は 0 ではなく 0.3 にする（疲れていても締切は守る）。

### P4.2 重み

```text
w_fit = [0.15, 0.25, 0.20, 0.20, 0.10, 0.10]   （合計 1.0。config.ts）
```

---

## P5. 段階2：日ごとのビーム探索（`day-beam.ts`）

元のモデル 8章を、ブロック単位の行動で実装する。

### P5.1 入力

| 入力 | 内容 |
|---|---|
| 日 d の空き | 10.5 の FreeSlot の一覧（時刻順）。`start`・`work_end`・`end`・`location_id` |
| その日のクォータ | P3.2（繰り越し分を含む） |
| 方向 k の重み | P5.4 の w_k（今日なら状態で調整したもの。P9.1） |
| その日にすでにある項目 | `now` より前の骨組み・`locked_items`（作業量に数える） |

### P5.2 状態

```text
state = {
  gapIndex,          // いま埋めている空きの番号
  cursor,            // その空きの中の現在位置（時刻）
  last,              // 直前に置いたもの："start" | "task" | "buffer" | "free"
  hasTaskInGap,      // いまの空きにすでにタスクを置いたか
  remaining,         // クォータごとの残り（分）
  dayTaskMinutes,    // その日のタスク合計（now より前の分を含む）
  items,             // 置いた項目（PlannedItem）
  done,              // すべての空きを閉じたか
}
```

初期状態：`gapIndex = 0`、`cursor = 最初の空きの start`、`hasTaskInGap = false`（次の空きに移るたびに false に戻す）。空きに入るたびに、その空きが45分以上なら先頭に15分のバッファを自動で置く（`last = "buffer"`）。

### P5.3 行動（Expand）

`done` でない状態から、次の行動で新しい状態を作る。`avail = work_end − cursor`。

| 行動 | 内容 | 条件（ハード制約） |
|---|---|---|
| **T：タスクを置く** | 残りのあるクォータ c について、長さ L ∈ Lengths(c) ごとに1つずつ。`hasTaskInGap` が true なら、先にバッファ b ∈ {15, 30} を置く（2通り。間に自由時間があっても置く。Validator の BUFFER_SHORTAGE は「タスクとタスクの間のバッファ」を見るため）。置いたら `last = "task"`、`hasTaskInGap = true` | Fit > 0（P4）、`dayTaskMinutes + L ≤ L_max`、締切タスクは終わり ≤ `deadline_at`、`b + L ≤ avail` |
| **F：自由時間にする** | 自由時間を f ∈ {30, 60} 分置き、cursor を進める。`last = "free"` | `f + 15 ≤ avail`（あとに15分以上残る） |
| **C：この空きを閉じる** | `last = "task"` かつ `avail ≥ 15` なら15分のバッファを置いてから、空きの `end` までを自由時間にして次の空きへ。次の空きがなければ `done = true` | なし |

- Lengths(c)：
  - 締切・任意クォータで分割可：{30, 45, 60, 75, 90, 105, 120} のうち残り以下のもの（残りが30未満なら、残りが15の倍数ならその値も）
  - 分割不可：{`estimated_minutes`}（残りがそれ以上のとき）
  - 目標セッション：{その回の長さ}
- **時間帯の希望がある目標セッション**は、開始を s = max(cursor + b, band の開始) を5分単位に切り上げた時刻にする（b は直前のバッファ。`hasTaskInGap` が false なら 0）。cursor 〜 s − b は自由時間にする（15分未満ならバッファを前に延ばす）。長さがすべて15分の倍数なので、こうしないと cursor が band の開始にちょうど届かず、置ける位置がなくなることがある
- 自由時間どうし・バッファどうしが続いたら1つにまとめる
- 行動 T の直前バッファの長さの選択（15 / 30）が、方向によるバッファの量の違いを生む

### P5.4 部分評価（ビームの順位）

元のモデル 8.4 の式を、日ごとに計算する。

```text
Score_k(state) = w1·Ach + w2·Fit + w3·DS + w4·Buf + w5·Free − w6·Over − Penalty
```

| 項 | 計算（その日の、いま置いた分まで） |
|---|---|
| Ach | Σ W_c × 置いた分 ÷ Σ W_c × クォータ（その日のすべてのクォータ。任意を含む） |
| Fit | 置いたタスクの q の分数による加重平均（まだ何も置いていなければ 0.5） |
| DS | 必須クォータのうち置いた分の割合 |
| Buf | min(1, バッファの合計 ÷ (0.5 × タスクの合計))（タスクが0なら 1） |
| Free | 自由時間の合計 ÷ その日の空きの合計 |
| Over | max(0, dayTaskMinutes − T_comf)² ÷ (L_max − T_comf)² |
| Penalty | 10 × max(0, 必須クォータの残り − 残りの空きで置ける最大の分) ÷ 60 （置ききれないことが確定した状態を下げる） |

方向ごとの重み w_k = (w1, …, w6)（元のモデル 10.1 の方向ベクトルから取る。P9で状態により調整）：

| 方向 | w1 Ach | w2 Fit | w3 DS | w4 Buf | w5 Free | w6 Over |
|---|---|---|---|---|---|---|
| A（達成） | 1.00 | 0.60 | 1.00 | 0.30 | 0.20 | 0.20 |
| B（バランス） | 0.75 | 0.85 | 0.80 | 0.70 | 0.65 | 0.70 |
| C（回復） | 0.55 | 0.80 | 0.60 | 0.95 | 0.90 | 1.00 |

（w1 = Achievement、w2 = TaskFit、w3 = DeadlineSafety、w4 = Buffer、w5 = FreeTime、w6 = Recovery の成分）

### P5.5 探索の手順

```text
beam = [初期状態]
finished = []
loop（最大 60 回）:
  next = []
  for s in beam:
    if s.done: finished.push(s); continue
    next.push(...Expand(s))
  if next が空: break
  同じキーの状態は1つにまとめる（スコアの高い方を残す。同点は items の文字列の辞書順）
    キー = gapIndex・cursor・last・hasTaskInGap・クォータごとの remaining・dayTaskMinutes を文字列にしたもの
  beam = next をスコアの高い順に並べた先頭 K 件（K = 30）
beam に done でない状態が残っていたら（60 回で終わらなかった場合）、それぞれ行動 C を繰り返して残りの空きをすべて自由時間で閉じ、finished に入れる
finished をスコアで並べ、次の順で1つ選ぶ：
  ① 必須クォータの残りが最も少ない
  ② Score_k が最も高い
  ③ items を文字列にしたものが辞書順で最も小さい（決定論的にするため）
```

- 同点は必ず③で決める（乱数を使わない）
- 選んだ状態の必須クォータの残りは、P3.3 の繰り越しへ

### P5.6 1週間の計画にする

割り振り案 a と方向 k ごとに：

```text
carry = []
for d in 今日〜日曜:
  quotas = a.quotas[d] + carry のうち d に置けるもの
  best = DayBeam(d, quotas, w_k（d が今日なら P9.1 で調整）)
  carry = 繰り越し（P3.3）。繰り越せなければ失敗
week = now より前の骨組み・locked_items ＋ 各日の best.items ＋ 骨組み
```

- 同じ入力（日、クォータ、重み）の DayBeam の結果は使い回す（メモ化）。割り振り案どうしで同じ日が多いため
- 結果の計画 S(a, k) は最大 18 × 3 = 54 通り

---

## P6. 目的ベクトル F(S)（`objectives.ts`）

元のモデル 7章の7つを、すべて 0〜1（大きいほど良い）で定義する。計算の対象は、計画対象時間（`now`〜日曜）に置いた項目。

| # | 目的 | 式 |
|---|---|---|
| 1 | Achievement | Σ_i W_i × 置いた分_i ÷ Σ_i W_i × 残り_i（i は締切タスクと任意タスク。対象がなければ 1） |
| 2 | DeadlineSafety | 締切タスクごとの safety_i の平均（対象がなければ 1）。c_i = min(1, 置いた分 ÷ 今週に置くべき量)、s_i = c_i = 1 なら clip((締切 − 最後の項目の終わり) ÷ (締切 − now), 0, 1)、そうでなければ 0。safety_i = 0.5·c_i + 0.5·s_i。「今週に置くべき量」は、締切が日曜以前なら残り全量、それより後なら 0（来週以降の締切は c_i = 1 として扱う） |
| 3 | TaskFit | タスク項目の q（P4）の、分数による加重平均（タスクがなければ 1） |
| 4 | Buffer | min(1, バッファの合計 ÷ (0.5 × タスクの合計))（タスクが0なら 1） |
| 5 | FreeTime | 自由時間の合計 ÷ 計画対象時間の空きの合計 |
| 6 | Control | 0.5 × (タスク合計が T_comf 以下の日の数 ÷ 日数) ＋ 0.5 × (60分以上続く自由時間がある日の数 ÷ 日数)（日数 = 今日〜日曜） |
| 7 | Recovery | 1 − min(1, Σ_d O_d ÷ (日数 × O_max))。O_d = max(0, T_d − T_comf)²（元のモデル 7.1）、O_max = (L_max − T_comf)²、T_d はその日のタスク合計 |

- Control は、要件定義 7.1 の「時間コントロール感」のうち、MVP で測れるもの（詰め込みすぎていない日・自分の時間がまとまってある日）で近似したもの
- 目標タスク（R の全量を置くことはハード制約）は Achievement に入れない
- F(S) は `EnginePlanSchema.features`（P10）として出力し、DB の `weekly_plans.features` に保存する（P9.2 の学習で使う）

---

## P7. 段階3・5：実行可能集合と Pareto Frontier

### P7.1 実行可能集合（元のモデル 6章）

段階2で作った計画のうち、次をすべて満たすもの。

- Validator（10.11、mode = `generate`）の errors が0件
- 目標タスクの `end_at > now` の合計 = R（全量）
- 締切が日曜以前の締切タスクは、残り全量を置いている

Validator が error を出すのは実装の誤りなので、そのような計画はテストで0件にする（捨てるのは安全のため）。

実行可能な計画が1つもない → P10.4（成立しない場合）。

### P7.2 Pareto Frontier（元のモデル 9章）

```text
A が B を支配する ⇔ すべての k で f_k(A) ≥ f_k(B) − ε、かつ、ある j で f_j(A) > f_j(B) + ε   （ε = 1e-9）
𝒫 = { S ∈ 𝒮₁ : どの計画にも支配されない }
```

- 目的ベクトルがまったく同じ計画は、items を文字列にしたものが辞書順で小さい方だけ残す
- 目的が7つあるため、𝒫 は 𝒮₁ の大部分になることが多い（それで問題ない。選択はP8の距離で行う）

---

## P8. 段階6：3方向への選択と多様性（`select.ts`）

### P8.1 方向ベクトル（元のモデル 10.1）

成分の順番：[Achievement, DeadlineSafety, TaskFit, Buffer, FreeTime, Control, Recovery]

```text
D_A（集中）   = [1.00, 1.00, 0.60, 0.30, 0.20, 0.70, 0.20]
D_B（バランス）= [0.75, 0.80, 0.85, 0.70, 0.65, 0.90, 0.70]
D_C（ゆとり） = [0.55, 0.60, 0.80, 0.95, 0.90, 0.90, 1.00]
```

実際に使うのは、状態で調整し（P9.1）、学習の重みを足した（P9.2）ものを 0〜1 に収めた D_k(s_t)。

### P8.2 距離

```text
d(S, D_k) = ‖F(S) − D_k‖₂                                  … 方向との距離（元のモデル 10.2）
d_F(S_i, S_j) = ‖F(S_i) − F(S_j)‖₂                          … 目的空間の距離（元のモデル 11.1）
d_S(S_i, S_j) = 0.25 × ( |ΔWorkTime| ÷ 600 + |ΔBuffer| ÷ 300 + |ΔFreeTime| ÷ 600 + |ΔTaskCount| ÷ 10 )
                                                            … 構造の距離（元のモデル 11.2）。単位は分・件
D(S_i, S_j) = 0.5 × d_F + 0.5 × d_S                         … 統合距離（元のモデル 11.3）
```

- WorkTime・Buffer・FreeTime は計画対象時間のタスク・バッファ・自由時間の合計（分）、TaskCount はタスク項目の数
- D_min = 0.12（`config.ts`）

### P8.3 選び方

元のモデルの「方向ごとに近いものから順に、近すぎれば次の候補へ」を、順番に左右されない形にする。

```text
候補の集合 C = 𝒫。|𝒫| < 3 なら、支配された計画を min_k d(S, D_k) の小さい順に足して3件以上にする
C のすべての異なる3件の割り当て (S_A, S_B, S_C) について：
  条件：3組すべての D(S_i, S_j) ≥ D_min
  評価：Σ_k d(S_k, D_k)
条件を満たす中で評価が最小のものを選ぶ（同点は S_A・S_B・S_C の items の文字列の辞書順）
条件を満たす組がない → 条件を外して評価が最小の組を選び、warnings に CANDIDATES_TOO_SIMILAR
C に異なる計画が3件ない → 足りない分は評価が最小の計画を重ねて使い、warnings に CANDIDATES_TOO_SIMILAR
```

- |C| は最大54なので、組は最大 54 × 53 × 52 ≈ 15万通り。全部調べてよい
- S_A → 集中プラン（intensive）、S_B → バランスプラン（balanced）、S_C → ゆとりプラン（relaxed）

---

## P9. 状態による適応と学習

### P9.1 利用者の状態による適応（元のモデル 12章）

今日の状態で、方向ベクトル D_k と、今日のビームの重み w_k を調整する（すべての k に同じ量を足し、0〜1 に収める）。

| 条件 | D_k の調整 | 今日のビームの w_k の調整 |
|---|---|---|
| 今日の `fatigue: high` | Recovery +0.15、FreeTime +0.10、Achievement −0.10 | w6（Over）+0.20、w5（Free）+0.10 |
| 今日の `concentration: low` | TaskFit +0.10 | w2（Fit）+0.10 |
| 締切までの日数 n ≤ 2 の締切タスクがある | DeadlineSafety +0.10 | w3（DS）+0.10 |

- 3案は「頑張る・普通・休む」の固定ではなく、その日の状況に合わせた3つのトレードオフになる（元のモデル 12章の結論）
- Fit（P4）も状態で変わるので、疲れた日は高集中タスクがそもそも置かれない

### P9.2 選択からの学習（元のモデル 13章）優先度B

Demo Path が通ってから実装する。実装しない場合は w_user = 0 として動く。

```text
保存：user_settings.preference_weights（7次元。初期値 [0,0,0,0,0,0,0]）
更新：POST /api/plans/{id}/select のとき、選ばれた案 c と、選ばれなかった2案 o それぞれについて
      Δ = F(c) − F(o)
      w_user ← w_user + η × (1 − σ(w_user · Δ)) × Δ      （σ(x) = 1 ÷ (1 + e^(−x))、η = 0.03）
      各成分を −0.3〜0.3 に収める
使い方：D_k ← clip(D_k + w_user, 0, 1)（P8.1）
```

- これは一対比較モデル P(c ≻ o) = σ(w · (F(c) − F(o))) の対数尤度を1歩だけ大きくする更新
- 「今日は疲れた」などの一時的な状態では更新しない（元のモデル 13.3）
- 「今後は朝に勉強したい」のような長期の希望（η ≈ 0.15）は MVP では扱わない

---

## P10. 段階7：出力（`generate.ts`）

### P10.1 出力の形

3.1 の `EngineGenerateResultSchema`。`EnginePlanSchema` の `features` に入れる（`lib/schemas.ts` の `ObjectiveVectorSchema`）。

### P10.2 集計・説明文・理由

- 集計（`PlanSummary`）：10.12 の計算
- 説明文（`explanation`）：13.3 のテンプレート（案の style で選ぶ）
- 理由（`reason_code`・`reason`）：13.2。締切タスクのコードは、その案の style で決める（intensive → `DEADLINE_EARLY`、それ以外 → その日が最後の項目なら `DEADLINE_NEAR`、そうでなければ `DEADLINE_STEADY`）

### P10.3 バッファの候補

P5で置いたバッファのうち15分以上のものに、軽作業の候補を1つ付ける。候補にできるのは `Fit_buffer = b_i × FatigueFit × g ≥ 0.5` の軽作業（b_i はバッファ適性 high = 1.0・medium = 0.6・low = 0、FatigueFit は P4.1、g は `estimated_minutes` ≤ バッファの長さなら 1、そうでなければ 0）で、その日まだ候補にしていないもののうち W の最も高いもの（要件定義 7.3 の式）。集中プラン（S_A）で、どの日にも余裕（タスク合計 < T_comf）がある場合は、軽作業を1つずつ、最も余裕のある日の自由時間（60分以上）の先頭にタスクとして置く（`LIGHT_TASK`）。

### P10.4 成立しない場合

段階3で実行可能な計画が1つもない場合は、`{ ok: false, infeasible }` を返す。

- 回復手順（要件定義 6.12.3）：割り振り案の κ をすべて 0 にし、行動 T のバッファを15分だけにして、段階1〜3をもう一度行う
- それでも0件なら、失敗した「割り振り案 × 方向」のうち、繰り越しの残りが最も少ないものから `reason` と `required_changes` を作る（文言は 10.13）

---

## P11. 擬似コード（TypeScript）

```ts
export function generatePlans(context: PlanningContext): EngineGenerateResult {
  const ctx = PlanningContextSchema.parse(context);
  const skeleton = buildSkeleton(ctx);                // 10.4
  if (!skeleton.ok) return { ok: false, infeasible: skeleton.infeasible };
  const slots = buildFreeSlots(ctx, skeleton.days);   // 10.5
  const weights = computePriorities(ctx);             // 10.6

  const result = search(ctx, skeleton, slots, weights, { recovery: false });
  if (result.ok) return result;
  const retry = search(ctx, skeleton, slots, weights, { recovery: true });   // P10.4
  return retry.ok ? retry : { ok: false, infeasible: explainFailure(retry.failures) };
}

function search(ctx, skeleton, slots, weights, opts): SearchResult {
  const allocations = dedupe(ALLOCATION_GRID.map((p) => allocate(ctx, slots, weights, p, opts)));  // P3
  const directions = adjustDirections(ctx);           // P9.1・P9.2
  const memo = new Map<string, DayResult>();
  const plans: WeekPlan[] = [];
  const failures: Failure[] = [];

  for (const a of allocations) {
    for (const k of ["A", "B", "C"] as const) {
      const week = buildWeek(ctx, skeleton, slots, a, dayWeights(ctx, k), memo, opts);   // P5.6
      if (week.ok) plans.push(week.plan); else failures.push(week.failure);
    }
  }

  const feasible = plans.filter((p) => isFeasible(ctx, p));                 // P7.1
  if (feasible.length === 0) return { ok: false, failures };
  for (const p of feasible) p.features = evaluateObjectives(ctx, p);        // P6
  const pareto = paretoFilter(feasible);                                    // P7.2
  const { triple, warnings } = selectThree(pareto, feasible, directions);  // P8.3
  return { ok: true, plans: toEnginePlans(ctx, triple), warnings };        // P10
}

function dayBeam(day: DayInput, weights: BeamWeights): DayResult {
  let beam = [initialState(day)];
  const finished: DayState[] = [];
  for (let i = 0; i < CONFIG.beam.maxSteps; i++) {
    const next: DayState[] = [];
    for (const s of beam) {
      if (s.done) finished.push(s);
      else next.push(...expand(s, day));                // P5.3
    }
    if (next.length === 0) break;
    beam = topK(dedupeByItems(next), (s) => score(s, day, weights), CONFIG.beam.width);  // P5.4
  }
  return pickBest(finished, day, weights);              // P5.5 の①②③
}
```

---

## P12. 設定値（`lib/planning/config.ts`）

すべての数値をここに置く。デモの結果を見て調整してよい（変えたら PR に書く）。

| 名前 | 値 | 章 |
|---|---|---|
| `comfortableTaskMinutes`（T_comf） | 240 | P0.3・P6 |
| `allocationGrid.rho` | [0.30, 0.45, 0.85] | P3.1 |
| `allocationGrid.kappa` | [0, 0.35, 1.0] | P3.1 |
| `allocationGrid.goalOrder` | ["early", "free_desc"] | P3.1 |
| `optionalMaxPerDay` | 120 | P3.2 |
| `fitWeights`（w_fit） | [0.15, 0.25, 0.20, 0.20, 0.10, 0.10] | P4.2 |
| `lengths` | [30, 45, 60, 75, 90, 105, 120] | P5.3 |
| `bufferOptions` | [15, 30] | P5.3 |
| `freeOptions` | [30, 60] | P5.3 |
| `headBufferMinGap`・`headBuffer` | 45・15 | P5.2 |
| `beam.width`（K） | 30 | P5.5 |
| `beam.maxSteps` | 60 | P5.5 |
| `beamWeights` | P5.4 の表 | P5.4 |
| `penaltyPerHour` | 10 | P5.4 |
| `directions` | P8.1 の D_A・D_B・D_C | P8.1 |
| `diversity.minDistance`（D_min） | 0.12 | P8.2 |
| `diversity.lambdaF`・`lambdaS` | 0.5・0.5 | P8.2 |
| `stateAdjust` | P9.1 の表 | P9.1 |
| `learning.eta`・`learning.clip` | 0.03・0.3 | P9.2 |
| `lastDayFitFloor` | 0.3 | P4.1 |

---

## P13. 性能と決定論

| 項目 | 要件 |
|---|---|
| 決定論 | 同じ `PlanningContext` から、完全に同じ3案（JSON が一致）を返す。乱数・`Date.now()`・`Map` の挿入順以外の順序に依存しない。並べ替えは必ず最後に文字列で比べる |
| 時間 | デモの入力で、`generatePlans` が **3秒以内**（Node 24、開発者の PC）。要件定義 10章の「10秒以内」に余裕を残す |
| 時間を超えた場合の調整順 | ① K を 30 → 20 にする ② `lengths` から 75・105 を外す ③ `allocationGrid.goalOrder` を1つにする（`config.ts` の変更だけで行う） |

---

## P14. テスト（`lib/planning/__tests__/`）

入力は `fixtures.ts`（10.14 と同じ。now = 2026-10-05 7:00、G1、目標の時間帯は平日 evening）。

**単体テスト**

- [ ] `fit`：疲れた日の高集中タスクは Fit = 0。締切の最終日は 0 にならない。band の外に目標セッションを置くと Fit = 0
- [ ] `allocate`：ρ = 0.45 のとき、レポート（10/9締切）の完了目標日が水曜、ES（10/12締切）が木曜。どの割り振り案でも月曜に目標セッションがある
- [ ] `dayBeam`：空き1つ（13:50〜19:00）、締切クォータ60分×2、目標セッション60分（evening）→ 目標は 18:00 以降、締切タスクどうしの間にバッファ15分以上、すべての必須クォータを置く
- [ ] `objectives`：タスクなしの計画は Achievement・TaskFit・Buffer・Recovery が 1
- [ ] `paretoFilter`：人工の F で、支配された計画だけが消える
- [ ] `selectThree`：人工の F（D_A・D_B・D_C そのものに近い3つ＋中間）で、それぞれの方向に近いものが選ばれる。D_min を大きくすると `CANDIDATES_TOO_SIMILAR`

**結合テスト（`generatePlans`）**

- [ ] 3案とも Validator の errors が0件、目標タスクの合計が360分
- [ ] **再計画のデモの前提**：3案とも、月曜の 18:00 以降に始まる目標のメイン（TOEIC リスニング演習）がある（バランスプランは必須。ほかの2案も目標の時間帯が evening なので同じになる）
- [ ] F の順序：Achievement(集中) ≥ Achievement(ゆとり)、FreeTime(ゆとり) ≥ FreeTime(集中)、Recovery(ゆとり) ≥ Recovery(集中)
- [ ] 3案のどの2案も D ≥ D_min（warnings に `CANDIDATES_TOO_SIMILAR` がない）
- [ ] 同じ入力で2回実行すると JSON が一致する
- [ ] 実行時間が3秒以内（CI では余裕を見て10秒）
- [ ] 今日のチェックインが fatigue: high → 今日に高集中タスクがない（締切の最終日を除く）
- [ ] 23:30〜24:00 にタスク・バッファがない
- [ ] 移動時間表から「自宅→大学」を消すと infeasible。締切まで空きが足りないタスクを足すと infeasible で `required_changes` がある

---
