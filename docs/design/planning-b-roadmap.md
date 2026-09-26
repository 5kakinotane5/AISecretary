# 担当B：Planning Engine の作業手順

> 設計書 `schedule.md`（16章）の B の列を、作業の順番に並べ直したもの。章番号（例：10.4、P5）は設計書の章を指す。
> 各手順の「完了の条件」は設計書の受け入れテスト。そこが通れば次へ進む。

最終更新：2026-09-26

## 目次

1. [B の担当と、守ること](#1-b-の担当と守ること)
2. [最初にやること](#2-最初にやること)
3. [PR の区切り（A が待っているもの）](#3-pr-の区切りa-が待っているもの)
4. [作る順番](#4-作る順番)
5. [作業の終わりに](#5-作業の終わりに)
6. [設計書の 16.2 との対応](#6-設計書の-162-との対応)

---

## 1. B の担当と、守ること

**担当の範囲**（16.1）：7.2（目標時間3案の数値）、10章、12.4・12.5、13章、1.7（テスト環境）

**ファイル**：`lib/planning/*`、`vitest.config.mts`、CI（`.github/workflows/ci.yml`）、`package.json` の `test` スクリプト

**守ること**

- `lib/planning/` は**純粋関数だけ**にする。DB・LLM・時計（`Date.now()`・`new Date()`）・環境変数に触れない（1.2）。「今」は `PlanningContext.now` だけを使う
- **A との境界**（16.1）：入力は `PlanningContext`、出力は `EngineGenerateResult`・`EngineReplanResult`・`ValidationResult`（型は `lib/schemas.ts` にある）。A は B の関数をそのまま呼ぶだけ
- DB なしで開発・テストする。入力は `fixtures.ts`（`mocks/` から作る）
- **決定論**（P13）：同じ入力から、完全に同じ結果（JSON が一致）を返す。乱数を使わない。並べ替えは最後に文字列で比べる
- `config.ts` の数値の調整は自由にしてよい（17.2。テストが通る範囲で。変えたら PR に書く）。それ以外（配置のルール、スキーマなど）を変えたいときは、設計書に追記してから

---

## 2. 最初にやること

1. main をクローンして `npm ci` を実行する
   - パッケージ（`vitest` を含む）は A が追加済み。**B がパッケージを足す必要はない**
   - `package.json` の `"test": "vitest run"` は**まだ入っていない**。手順1で B が足す（AGENTS.md・1.7。パッケージの追加ではないので、事前の報告は要らない）
2. （画面も見たい場合）`.env.local` を用意して `npm run dev`
   - Supabase を入れたので、`.env.local`（Supabase のキー・デモ用アカウント）がないとログインできない。値は A から DM でもらう
   - Engine の開発だけなら、`npm test` だけで進められる（dev サーバーはいらない）
3. 資料を読む

| 資料 | 読むところ |
|---|---|
| `docs/design/README.md` | 0章、17章（決定事項・既知の制約） |
| `docs/design/common.md` | 1.2（ファイル構成）、1.5（用語）、1.7（テスト環境）、3章（スキーマ） |
| `docs/design/planning.md` | 10章と付録P（全部） |
| `docs/design/backend.md` | 7.2・7.3（目標時間3案の数値）、8.3（PlanningContext の中身）、9.1.2（毎週の予定の展開） |
| `docs/design/plans-replan.md` | 11.3（カレンダーの id）、12.4・12.5（再計画）、13章（理由・説明文） |
| 数学モデルの HTML（`docs/`） | 付録P の元の考え方 |

4. ブランチは**区切りごとに**作る（3章）。`feature/planning-engine` 1本で最後まで進めると、A はマージされるまで何も使えない

```bash
git switch main
git pull
npm ci
git switch -c feature/planning-<作業名>
```

---

## 3. PR の区切り（A が待っているもの）

A は、B の PR が main にマージされてから使える。次の★で PR を出す。

| ★ | 手順 | 出すもの | A が待っている作業 |
|---|---|---|---|
| ★1 | 手順2 | `goal-candidates.ts`（`computeGoalCandidateHours()`） | ヒアリングのステップ5〜6（Demo Path ③「3案が 9 / 6 / 3 時間」）。**★3 もそろってから使える** |
| ★2 | 手順3 | `skeleton.ts`（`expandFixedEvents()` を含む） | カレンダー、`planning-context.ts` |
| ★3 | 手順4 | `slots.ts`（`computeWeeklyFreeMinutes()` を含む） | ヒアリングのステップ5〜6（7.2.2 の上限に今週の空きの合計が要る） |
| ★4 | 手順5 | `validate.ts`・`summarize.ts` | `GET /api/mock/check` |
| ★5 | 手順9 | `generatePlans()`（と `reasons.ts`） | `POST /api/plans/generate`（Demo Path ⑤〜⑧） |
| ★6 | 手順10 | `replan()`・`diff.ts` | `POST /api/plans/replan`（Demo Path ⑨〜⑪） |

★1〜★3 は小さい。先に出すと A がすぐ進められる。★2 と ★3 は1つの PR にまとめてもよい（その場合、カレンダーの本番化は ★3 まで待つことになる）。

---

## 4. 作る順番

人が手で予定表を作るのと同じ順番。

### 手順1：準備

| 作るもの | 設計書 |
|---|---|
| `vitest.config.mts`（下のとおり） | 1.7 |
| `package.json` の scripts に `"test": "vitest run"` を足す | 1.7 |
| CI（`.github/workflows/ci.yml`）の最後に `- run: npm test` を足す | 1.7 |
| `lib/planning/config.ts`（係数・閾値） | P12、12.4 |
| `lib/planning/__tests__/fixtures.ts`（`mocks/` から `PlanningContext` を作る） | 10.14 |
| `lib/planning/__tests__/fixtures.test.ts`（fixture の確認。下記） | — |

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { environment: "node", include: ["lib/**/__tests__/**/*.test.ts"] },
});
```

**fixtures.ts の中身**（10.14）：now = `2026-10-05T07:00:00+09:00`、目標 G1（時間帯は平日 evening）、目標タスク2件、W = R = 360、チェックインなし、locked_items なし。

- `mocks/fixed-events.ts` の予定は、毎週の予定もデモの週（10/5〜10/11）の日時で書かれている。そのため手順3の前は、そのまま `fixed_events` に入れてよい

**fixtures.test.ts**：`PlanningContextSchema.parse(fixture)` が通ること、目標の W・R が360であることを確かめる。

- **テストが0件だと `vitest run` は失敗する**（終了コード1。「No test files found」）。CI に `npm test` を足すと、テストのない PR がすべて落ちる。そのため、手順1で必ず1件入れる

**完了の条件**：`npm test` が通る（fixtures.test.ts の1件）。CI でも通る

### 手順2：目標時間3案の数値 ★1

| 作るもの | 設計書 |
|---|---|
| `lib/planning/goal-candidates.ts`（`computeGoalCandidateHours()`） | 7.2.1・7.2.2 |

- 他の手順と独立していて、式もテストも設計書にそのまま書いてある。16.2 では B の段階4だが、A のヒアリングが先に必要とするので、ここで作る
- 入力の `weekly_free_minutes` は引数で受け取る（テストでは表の値を渡す）。実際の値を計算する `computeWeeklyFreeMinutes()` は手順4で作る
- 文章（characteristics など）は A の担当（7.2.3）。B は数値だけ

**完了の条件**：7.3 のテスト7件（`lib/planning/__tests__/goal-candidates.test.ts`）。デモ（TOEIC・10週・指定なし）で 9 / 6 / 3

> A が引き受けることになった場合は、この手順を飛ばす（チームで決める）。

### 手順3：骨組み ★2

| 作るもの | 設計書 |
|---|---|
| `lib/planning/skeleton.ts`：睡眠・固定予定・移動を並べる（`buildSkeleton()`） | 10.4 |
| 同じファイルに `expandFixedEvents(events, fromDate, toDate)`：毎週の予定を展開する | 9.1.2 |

`expandFixedEvents()` の決まり（9.1.2）：

- `recurrence: "weekly"`：`start_at` の曜日・時刻を、範囲内の**すべての週**に展開する（開始日より前の週にも出す）
- `recurrence: null`：その日時だけ
- **1週間分（PlanningContext）では、展開した予定の `id` は元の id のまま**
- カレンダー（複数週）用の id は `{元のid}_{YYYY-MM-DD}`（元の日付の回は元の id。11.3）。1週間分でも、元の週以外なら `_{日付}` が付く点が PlanningContext と違うので、どちらで呼ばれるかを引数で分けるなど、**A と形を相談する**

**完了の条件**（10.14）：月曜の移動が 8:10〜9:00（自宅→大学、直前）と 13:00〜13:50（大学→自宅、直後）。`expandFixedEvents()` の単体テスト（毎週の予定が範囲内の全週に出る、単発の予定はその日だけ、id の付け方）

### 手順4：空き時間 ★3

| 作るもの | 設計書 |
|---|---|
| `lib/planning/slots.ts`：骨組みの隙間を取り出す | 10.5 |
| 同じファイルに `computeWeeklyFreeMinutes(context)`：now〜日曜の空き（`work_end` まで）の合計分 | 10.2・7.2.2 |

- `computeWeeklyFreeMinutes()` は、A がヒアリングで 7.2.2 の上限（今週の空きの合計 × 0.4）を出すのに使う。`goals`・`tasks` が空の context でも動くこと（10.2）

**完了の条件**（10.14）：月曜の空きが 13:50〜19:00 と 19:45〜24:00（work_end は 23:30）。`computeWeeklyFreeMinutes()` を fixture で呼ぶと、各日の空き（`work_end` まで）の合計と一致する

### 手順5：検査と集計 ★4

| 作るもの | 設計書 |
|---|---|
| `lib/planning/validate.ts`（`validatePlan()`） | 10.11 |
| `lib/planning/summarize.ts` | 10.12 |

- 一から書かない。モックの `lib/mock/validate.ts`・`lib/mock/summarize.ts` の中身を `lib/planning/` に移し（1.6）、設計書で増えた分を足す
  - validate：mode（`generate`・`replan`・`stored`）、`PAST_PLACEMENT`・`LOCKED_ITEM_CHANGED`、`GOAL_HOURS_MISMATCH` の条件
  - summarize：`overload` は「いずれかの日のタスク合計が作業上限の80%を超える」（補正 C-9）。`explanation` はモックと同じく引数で受け取る（文章は手順9の `reasons.ts`）
- **`CANDIDATES_TOO_SIMILAR` は手順9で足す**。統合距離 D（P8.2）を使うため、`select.ts` ができてからにする。★4 の時点では、`/api/mock/check` にこの warning が出ないだけで、A の作業は止まらない
- モックの API がまだ `lib/mock/` を使っているので、**モックのファイルは消さない**（消すのは A がその API を本番化したとき）

**完了の条件**（10.14）：モックの3案（`mocks/plans/`）を mode = stored で検査すると errors が0件。モックのバランスプランの集計が `lib/mock/summarize.ts` と同じ（overload だけ変わりうる）

### 手順6：優先度

| 作るもの | 設計書 |
|---|---|
| `lib/planning/priority.ts` | 10.6 |

**完了の条件**（10.14）：W（レポート）> W（ES）> W（企業研究）

### 手順7：相性と割り振り

| 作るもの | 設計書 |
|---|---|
| `lib/planning/fit.ts`（適合度） | P4 |
| `lib/planning/allocate.ts`（どのタスクを何曜日に何分やるか） | P3 |

**完了の条件**（P14 単体テスト）

- fit：疲れた日の高集中タスクは Fit = 0。締切の最終日は 0 にならない。時間帯（band）の外に目標セッションを置くと Fit = 0
- allocate：ρ = 0.45 のとき、レポート（10/9締切）の完了目標日が水曜、ES（10/12締切）が木曜。どの割り振り案でも月曜に目標セッションがある

### 手順8：1日の中に並べる

| 作るもの | 設計書 |
|---|---|
| `lib/planning/day-beam.ts`（ビーム探索） | P5.1〜P5.5 |
| 1日ずつの結果を1週間の計画にまとめる | P5.6 |

**完了の条件**

- P14 単体テスト：空き1つ（13:50〜19:00）、締切クォータ60分×2、目標セッション60分（evening）→ 目標は 18:00 以降、締切タスクどうしの間にバッファ15分以上、すべての必須クォータを置く
- fixture で1週間分を作り、**月曜 18:00 以降に TOEIC があること**と、実行時間を確かめる（16.2 の「Day 1 のうちに」。再計画のデモの前提）

### 手順9：採点して3案を選ぶ ★5

| 作るもの | 設計書 |
|---|---|
| `lib/planning/objectives.ts`（目的ベクトル F(S)） | P6 |
| `lib/planning/select.ts`（Pareto・3方向への選択・多様性） | P7・P8 |
| `lib/planning/reasons.ts`（理由コード → 文章、説明文） | 13.2・13.3 |
| `lib/planning/recover.ts`（成立しないとき） | 10.13・P10.4 |
| `lib/planning/generate.ts`（`generatePlans(context)`） | P10・P11 |
| `validate.ts` に `CANDIDATES_TOO_SIMILAR` を足す（手順5で後回しにした分） | 10.11・P8.2 |

- 状態による適応（P9.1）、バッファの候補（`suggested_task_id`。P10.3）もここで入れる。選択からの学習（P9.2）は優先度B で、Demo Path が通ってから
- 3秒を超えたら、P13 の順で `config.ts` を調整する

**完了の条件**（P14）

- 単体：objectives（タスクなしの計画は Achievement・TaskFit・Buffer・Recovery が 1）、paretoFilter、selectThree（D_min を大きくすると `CANDIDATES_TOO_SIMILAR`）
- 結合（`generatePlans`）：
  - [ ] 3案とも Validator の errors が0件、目標タスクの合計が360分
  - [ ] 3案とも、月曜の 18:00 以降に始まる TOEIC リスニング演習がある
  - [ ] F の順序：Achievement(集中) ≥ Achievement(ゆとり)、FreeTime(ゆとり) ≥ FreeTime(集中)、Recovery(ゆとり) ≥ Recovery(集中)
  - [ ] どの2案も D ≥ D_min（`CANDIDATES_TOO_SIMILAR` がない）
  - [ ] 同じ入力で2回実行すると JSON が一致する
  - [ ] 実行時間が3秒以内（CI では10秒）
  - [ ] 今日のチェックインが fatigue: high → 今日に高集中タスクがない（締切の最終日を除く）
  - [ ] 23:30〜24:00 にタスク・バッファがない
  - [ ] 移動時間表から「自宅→大学」を消すと infeasible。空きが足りないタスクを足すと infeasible で `required_changes` がある

### 手順10：再計画 ★6

| 作るもの | 設計書 |
|---|---|
| `lib/planning/replan.ts`（`replan(context, before, intent)`） | 12.4 |
| `lib/planning/diff.ts`（変更点） | 12.5 |

- 再計画はビーム探索を使わず、**ルール**で行う（12.4）
- 変更点は、操作をしながら記録する（Before と After を比べて推測しない。12.5）
- `summary_message` は 13.4 のテンプレート

**完了の条件**（12.7。`lib/planning/__tests__/replan.test.ts`。バランスプランを生成し、now = 10/5 18:00、state_change fatigue high）

- [ ] Validator（mode = replan）の errors が0件（`LOCKED_ITEM_CHANGED` なし）
- [ ] 今日の 18:00 以降に高集中タスク（リスニング・ES）がない
- [ ] 18:00〜18:30 休憩、18:30〜18:50 単語、18:50〜19:00 バッファ
- [ ] 今週の目標タスクの合計が360分のまま
- [ ] ES の項目がすべて締切（10/12）より前の日
- [ ] 夕食の項目が変わっていない
- [ ] changes に replaced（リスニング → 休憩・単語・バッファ）、other_day_changes にリスニングの残り40分の moved
- [ ] fatigue: medium でも同じ結果
- [ ] now をまたぐ自由時間（TOEIC を夕食後に置き、17:00〜19:00 を自由時間にした Before）でも同じ結果になり、17:00〜18:00 の自由時間が残る

---

## 5. 作業の終わりに

PR を出す前に、毎回次を通す。

```bash
npm test
npm run typecheck
npm run lint
```

- テストは DB・LLM・ネットワークを使わない（1.7）
- `config.ts` の数値を変えたら、PR の説明に書く
- 設計書と違う判断をしたら、PR の説明に「設計書との違い」として書く（配置のルールなどは、先に設計書に追記する。17.2）

---

## 6. 設計書の 16.2 との対応

| この手順書 | 16.2 の段階 | 変えたところ |
|---|---|---|
| 手順1・3・4 | 1（vitest、fixtures、skeleton・slots） | `expandFixedEvents()`・`computeWeeklyFreeMinutes()` を明記。`test` スクリプトと fixture の確認テストを手順1に入れた |
| 手順2 | 4（goal-candidates） | A が先に必要とするので前に出した |
| 手順5 | 3（validate・summarize） | モックの検査で確かめるため前に出した。`CANDIDATES_TOO_SIMILAR` だけ手順9に回した |
| 手順6〜8 | 2（priority、fit・allocate・day-beam） | |
| 手順9 | 3（objectives・select・generate・reasons・recover） | |
| 手順10 | 5（replan・diff） | |
