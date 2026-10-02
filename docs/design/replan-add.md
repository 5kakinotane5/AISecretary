# 設計書：会話で予定・タスクを足す（12章の拡張。12.16〜）

> 設計書（`docs/design/`）の一部。`replan-chat.md`（12.8〜12.15）の上に足す。12.8〜12.15 の決まりは、ここに書いていない限りそのまま。
> 決めた日：2026-10-02（柿澤）。同日改訂：予定は「毎週」も入れられるようにし、「バイトのある日に」のように今週の予定を手がかりに日を選べるようにした。

## 12.16 方針：予定・タスク・目標の行動の区別

| 種類 | データ | 守り方 | 会話での扱い |
|---|---|---|---|
| **予定** | `fixed_events`（項目は kind `fixed`） | その時間帯は**必ず空ける**。重なる案は errors | `add_event`：1回きり（今日〜日曜）か**毎週**（曜日を指定） |
| **タスク** | `tasks`（`deadline_at` あり・`goal_id` null） | 締切までに**必ず終える**。間に合わない案は errors | `add_task`（新規） |
| **目標の行動** | `tasks`（`goal_id` あり） | 週の目標時間は**めやす**。足りなくなっても warnings で通す。時間が足りないときは**最初に譲る** | 今まで通り（shorten・skip・postpone）。目標そのものの変更は /interview |
| 締切なしのタスク | `tasks`（どちらも null） | 目標の行動と同じく緩い（入らなければ warnings） | `add_task` では作らない（締切を聞く。12.20） |

- 区別のデータと検査（`FIXED_EVENT_OVERLAP`・`DEADLINE_VIOLATION`）は今もある。この章で足すのは、①会話で予定（今日以外・毎週も）とタスクを足せること、②「目標の行動は緩め」を会話の経路の並べ方に入れること
- 毎週の予定は `fixed_events.recurrence = "weekly"` で保存する。今ある仕組み（`expandFixedEvents`）で、来週以降のカレンダーと計画の生成にもそのまま出る
- `/plans` の生成と `tired_plan`・fallback（Engine。`lib/planning`）は変えない
- この章でもできないこと：今ある予定の**取り消し・時刻の変更**（「今日のバイトがなくなった」）。今回は chat で「予定の取り消しはまだできません」と伝える

## 12.17 操作の変更（`lib/schemas.ts`）

`ReplanOpTypeSchema` に `"add_task"` を足す。`ReplanOpLlmSchema` に次の項目を足す（strict のため、使わないときは null）。

```ts
  repeat: z.enum(["once", "weekly"]).nullable(), // add_event。null は "once"
  weekday: z.enum(["月", "火", "水", "木", "金", "土", "日"]).nullable(), // add_event の weekly
  category: FixedCategorySchema.nullable(),     // add_event。null は "other"
  deadline_date: z.string().nullable(),         // add_task。"YYYY-MM-DD"
  deadline_time: z.string().nullable(),         // add_task。"HH:MM"。null は 23:59
  importance: LevelSchema.nullable(),           // add_task。null は "medium"
  concentration: LevelSchema.nullable(),        // add_task。null は "medium"
```

- `add_event`（once）：`date` を使えるようにする（null ＝今日）。今日以外では `start` は `"HH:MM"` だけ（`"now"` は今日だけ）
- `add_event`（weekly）：`weekday`・`start`（`"HH:MM"`）・`end` か `minutes`。`date` は使わない（null）。**1つの op で1つの曜日**。「毎週月水」は op を2つにする
- `add_task`：`title`、`minutes`（合計の所要時間。5〜600、5分に切り上げ）、`deadline_date`、`deadline_time`、`importance`、`concentration`
- 1つの案の ops は最大7個（「バイトのある日に」で日の数だけ op が並ぶため）。今の上限がこれより少なければ7にする

## 12.18 当てはめ（`apply-ops.ts`）

### add_event（1回きり・`date` が明日〜日曜のとき）

- 開始・終わりの決め方は今日と同じ（end → start＋minutes → start＋60分の仮置き）。その日の睡眠の開始より後に終わるもの、その日のアンカー（sleep・fixed・travel・locked）と重なるものは opErrors（文は今日と同じ）
- 今日より前・日曜より後 → opErrors「今週（{日曜の M/D}まで）の1回きりの予定だけ入れられます。毎週の予定なら入れられます」
- その日の locked でない task 項目のうち予定と重なるもの → 外して溢れに入れる（12.10 の 6 で、その日も候補にして置き直す）
- その日の空き時間（free・buffer）のうち予定と重なる部分 → 削る。外したタスクの跡は空き時間（隣はまとめる。内部の title は今まで通り）
- 移動は足さない（今日の add_event と同じ。location は null）
- FixedEvent の category は `category ?? "other"`、`recurrence: null`

### add_event（毎週）

1. 今週のその曜日の日付 `d` を求める（月曜始まりの今週）
2. FixedEvent を1行作る：`recurrence: "weekly"`、category・location は 1回きりと同じ
   - `d` が今日以降で、その時刻がまだ来ていない（今日なら終わりが now より後、かつ開始が cut 以降）→ `start_at` は `d` の日時。**今週の `d` に予定の項目を置く**（置き方は 1回きりと同じ。今日なら今の今日の add_event と同じ）
   - `d` が今日より前、または今日でもう始まっている → `start_at` は**来週の同じ曜日**の日時。今週には置かない。説明の facts に「来週から」と入れる
3. 今週の `d` に置けない（アンカーと重なる・睡眠にかかる）→ opErrors（1回きりと同じ文）。来週以降の重なりはここでは調べない（来週の計画の生成で扱う）

### 「バイトのある日に」など、今週の予定を手がかりにした指定

- プログラムは特別なことをしない。LLM が user の JSON の `week[].events`（12.20）を見て、当てはまる日ごとに add_event を並べる
  - 1回きり：「今週のバイトの日は帰りに30分スーパー」→ バイトのある今日以降の日ごとに once の add_event
  - 毎週：「毎週バイトの日は帰りにジム」→ バイトのある曜日ごとに weekly の add_event
- 並べた op のうち1つでも opErrors なら、今まで通りその案は通らない（feedback で LLM がその日を外すか時刻を変える）

### add_task

1. Task を作る：`id = newId()`、`goal_id: null`、`deadline_at = {deadline_date}T{deadline_time ?? "23:59"}:00+09:00`、`estimated_minutes = remaining_minutes = minutes`、`importance`・`concentration`（null は medium）、`splittable: true`、`interruptible: true`、`buffer_fit: "low"`、`status: "not_started"`
   - 締切が now 以前 → opErrors「締切が過ぎています」
2. 分ける：n = ceil(minutes / 90)。各回の長さはなるべく均等（5分単位、長い回が先）
3. 置く：各回を溢れ（12.10 の 6）と同じ決まりで置く
   - 候補の日：締切が今日か明日なら**今日（cut 以降）から**、それ以外は**明日から**。締切の日（その時刻より前に終わる）まで。日曜まで
   - 早い日から。1日に同じタスクは2回まで
   - 項目の reason「{M/D}の締切に間に合うように入れました」、reason_code は null（新しい値は作らない）
4. 締切が日曜より後：今週に入る分だけ置く。入らない分は warnings「{title}の残り{N}分は来週の計画で考えます」（errors にしない）
5. 締切が日曜以前で入らない回がある → 下の「目標の行動を譲る」をしてからもう一度置く。それでも入らない → unplaced（12.11 の errors「…締切に間に合いません」）

### 目標の行動を譲る（会話の経路だけ）

- **今日（12.10 の 4）**：キューを置いた結果、締切のあるタスクが溢れたら、今日に置いた目標の行動を**後ろから1つずつ**溢れに回して置き直す。締切のあるタスクが全部入るか、今日の目標の行動がなくなるまで繰り返す
- **明日以降（12.10 の 6・add_task・add_event で押し出されたもの）**：締切のあるタスクが候補の日に入らないとき、候補の日の locked でない目標の行動（同じ日の中では後ろから）を外して空ける。外した目標の行動は、締切のあるものを全部置いた後に、残りの空きへ置き直す
- 置けなかった目標の行動 → unplaced（締切なし）。warnings は今の GOAL_HOURS_MISMATCH から作る「今週の{目標名}が{N}分足りなくなります」だけにし、「…は今週に入りませんでした」と二重に出さない
- 締切なしのタスクも目標の行動と同じに扱う（目標の行動の次に譲る）

### 変更点（ReplanDiffBuilder）

- 予定を足した（今日以外・毎週の今週分も）→ その日の changes に added
- add_task で置いた回 → その日の changes に added
- 予定・タスクに押されて動いた項目 → 今まで通り moved

### 返す値

`applyOps` の戻り値に `newTasks: Task[]` を足す。`newFixedEvents` には毎週の予定も入る（recurrence "weekly"）。`updated_days` には、予定・タスクを足した日も入れる。

## 12.19 検査・保存・確定

- `checkOption`：`validatePlan` に渡す context は `tasks` に `newTasks`、`fixed_events` に `newFixedEvents` を足したもの（`INVALID_REFERENCE`・`DEADLINE_VIOLATION`・固定予定の時刻の一致を正しく見るため）。戻り値に `newTasks` を足す
  - 毎週の予定で `start_at` が来週のもの：今週に項目がないので、context に入れても検査には影響しない（そのまま入れてよい）
- 保存（`run.ts`）：`replan_proposals` の行に `new_tasks` を入れる。`new_fixed_events` は今まで通り（recurrence も入る）
- マイグレーション `supabase/migrations/0004_replan_new_tasks.sql`：
  - `alter table replan_proposals add column new_tasks jsonb not null default '[]';`
  - `apply_replan` を作り直し、`fixed_events` の insert の前に `insert into tasks select * from jsonb_populate_recordset(null::tasks, p.new_tasks);` を足す（`daily_plan_items.task_id` が tasks を参照するため、項目より前）。それ以外は 0002 と同じ。grant・revoke もそのまま書く
  - Supabase の SQL Editor で柿澤が流す
- `new_tasks` の行の形は `tasks` の列（`user_id` は default に任せる。`created_at` も default）
- accept の API・画面は変えない。確定後は `GET /api/tasks` に新しいタスクが、`/calendar` の来週以降の週表示に毎週の予定が出る

### 分かっている制限（今回は直さない）

- 毎週の予定は `expandFixedEvents` で**過去の週にも**出る（seed の毎週の予定と同じ動き。始まりの日を持つ列がないため）。予定表で前の週を開くと、足す前の週にも表示される
- 今週の計画で、毎週の予定の来週の分と重なる来週のタスクはまだない（来週の計画は未生成）ので問題にならない

## 12.20 プロンプト（12.13 ① に足す）

system に足す：

```text
# 予定・タスク・目標の行動の区別
- 予定：時刻が決まっていること（面接・バイト・授業・飲み会・通院・ジム）。add_event。その時間は必ず空ける
- タスク：いつまでに終わらせること（レポート・課題・ES・申込）。add_task。締切までに必ず終える
- 目標の行動：goal が true のタスク（TOEIC の勉強など）。他の2つより緩く、時間が足りないときは減らしてよい
- 目標そのものを変えたい（「英語をもっとやりたい」）は、ここでは変えられない。chat で「設定の『新しい目標を相談する』から変えられます」と伝える
- 今ある予定の取り消し・時刻の変更（「今日のバイトがなくなった」「授業が休講」）は、まだできない。chat でそう伝える

# add_event の書き方
- 1回きり（repeat "once"）：日付は week にある date から選ぶ（「明日」「木曜」「今週の金曜」）。week にない日（来週以降の1回きり）は chat で「今週の予定だけ入れられます」と伝える
- 毎週（repeat "weekly"）：「毎週」「これからずっと」「週1で」と言われたとき。weekday に曜日、date は null。曜日が複数なら op を曜日の数だけ並べる
- 「バイトのある日」「授業の日」のように予定を手がかりに言われたら、week の events を見て当てはまる日を選ぶ。毎週なら、その予定のある曜日ごとに weekly の op を並べる。1回きりなら、今日以降の当てはまる日ごとに once の op を並べる
- 「バイトの後に」「授業の前に」のように時刻を言われなかったら、week の events の終わり・始まりの時刻から決める（後なら終わりの時刻、前なら始まりから minutes を引いた時刻）
- category：授業 "class"、バイト・仕事 "work"、食事 "meal"、友達・飲み会 "social"、家族 "family"、それ以外 "other"

# add_task の書き方
- 締切（deadline_date）と所要時間（minutes）が両方必要。どちらか分からなければ question で1つだけ聞く（例：「いつまでに終わらせたいですか？（例：金曜の夜まで、10/9まで）」「どれくらいかかりそうですか？（例：2時間、30分）」）。推測で埋めない。締切の時刻が分からなければ deadline_time は null
- タスクは長くても分けなくてよい（プログラムが分けて置く）
```

user の JSON に足す：

```json
"week": [
  { "date": "2026-10-05", "weekday": "月", "events": ["1限 マクロ経済学 9:00〜10:30", "バイト 17:00〜22:00"] },
  …
]
```

- 今日〜日曜。`events` はその日の固定予定（kind `fixed`）の「タイトル 開始〜終わり」。食事・睡眠・移動は入れない
- 毎週の予定の曜日を判断できるよう、今日より前の曜日（月曜〜昨日）も `"past": true` を付けて入れる（`events` は同じ形）。past の日に once の予定は入れない

## 12.21 説明の facts（12.12）

facts に足す：

- 足した予定：`"added_events": ["10/8（木）15:00〜16:00 面接", "毎週水曜 18:00〜19:00 ジム（今週は10/7から）", "毎週月曜 9:00〜10:00 自習（来週の10/12から）"]`
- 足したタスク：`"added_tasks": [{ "title": "統計レポート", "total_minutes": 120, "deadline": "10/9", "placed": ["10/6（火）60分", "10/7（水）60分"] }]`
- 数字の検査は、これらの数字も facts として扱う

## 12.22 画面

- `/replan` の入力の例（プレースホルダーや例のボタンがあれば）に「木曜15時から面接」「金曜までにレポート2時間」「毎週水曜18時からジム」を足す
- ChangeList は今のままで added として出る（変えない）

## 12.23 受け入れテスト

単体（バランスプラン・now 10/5（月）18:00）：

- [ ] add_event once date 10/8 15:00〜16:00 → 10/8 の重なるタスクが同じ日か別の日に移り、Validator errors 0
- [ ] add_event once date 10/8 で授業と重なる → opErrors
- [ ] add_event once date 10/12（来週）→ opErrors
- [ ] add_event weekly 水 18:00〜19:00 → newFixedEvents の1行が recurrence "weekly"・start_at 10/7 18:00。10/7 に項目が置かれ、errors 0
- [ ] add_event weekly 月 9:00〜10:00（今日だがもう過ぎた）→ start_at が 10/12 9:00。今週の項目は増えない。errors 0
- [ ] add_event weekly 月 20:00〜21:00（今日のこれから）→ start_at 10/5 20:00、今日に項目が置かれる
- [ ] 1つの案に add_event once を3つ（別の日）→ 3日とも置かれ、errors 0
- [ ] add_task 120分・締切 10/9 23:59 → 明日（10/6）から 60分×2 で置かれ、締切前に終わる。errors 0。newTasks が1件
- [ ] add_task 30分・締切 10/6 → 今日の cut 以降か 10/6 に置かれる
- [ ] add_task 締切 10/14（来週）・600分 → 今週に入る分だけ置き、warnings「…来週の計画で考えます」
- [ ] 空きが足りない日に締切タスクを足す → 目標の行動が外れ、warnings に「今週のTOEIC学習が{N}分足りなくなります」。締切タスクは置かれる
- [ ] 目標の行動を全部外しても入らない → errors「…締切に間に合いません」
- [ ] 今日：キューに目標の行動と締切タスクがあって全部は入らない → 締切タスクが残り、目標の行動が溢れる
- [ ] 結果を buildReplanRows() に渡して例外が出ない。new_tasks の行が tasks の列の形、new_fixed_events の行に recurrence が入る

手動（`LLM_MODE=on`、10/5 18:00）：

- [ ] 「木曜15時から1時間面接」→ 10/8 に予定、重なるタスクが移る
- [ ] 「毎週水曜の18時からジムに行くことにした」→ 10/7 に予定。確定すると /calendar の来週（10/14）にも出る
- [ ] 「バイトのある日は、帰りに30分スーパーに寄りたい」→ バイトのある今日以降の日に、バイトの終わりから30分の予定（1回きり）
- [ ] 「これから毎週、バイトの日は帰りにジム1時間」→ バイトの曜日ごとに毎週の予定
- [ ] 「金曜までに統計のレポート2時間やらなきゃ」→ 明日以降に置く案。確定すると /calendar の週表示に出る
- [ ] 「レポートやらなきゃ」→ 締切か時間を聞く question
- [ ] 「来週の月曜に面接」→ 今週の1回きりだけと伝える chat
- [ ] 「今日のバイトなくなった」→ 取り消しはまだできないと伝える chat
