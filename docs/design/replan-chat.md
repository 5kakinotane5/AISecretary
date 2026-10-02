# 設計書：会話で再計画する（12章の拡張。12.8〜）

> 設計書（`docs/design/`）の一部。12.1〜12.7（意図3種類＋Engine）は**残したまま**、その上に「会話で提案する」経路を足す。
> 決めた日：2026-10-02（柿澤）。テストの元は `docs/scenarios/`。
> 予定（今日以外・毎週）・タスクを足すのは [replan-add.md](replan-add.md)（12.16〜）。

## 12.8 方針

- AI は「自由に会話して提案を考える秘書」にする。`docs/scenarios/` の挙動を目指す
- **役割を分ける**：
  - LLM は「何をどう変えるか」を**操作**（12.9）で出し、利用者への文章を書く
  - 時刻の計算・並べ直し・検査は**コード**が行う（LLM に時刻の計算をさせない）
  - 文章に出す**数字はコードが計算した値だけ**を使う（12.12 の数字の検査）
- 1回の発言で、案を**1〜3個**出せる。利用者が選び、「この計画にする」で確定（accept は今と同じ）
- 会話の履歴は画面が持ち、毎回 API に送る（サーバーには保存しない。再読み込みで消えてよい）
- **今の経路は残す**：`LLM_MODE=off`、または LLM が失敗したときは、12.2 の意図＋Engine の経路に戻す。Demo Path は壊さない
- 変えられるのは今まで通り**今日の now 以降**と、溢れた分の**明日〜日曜**。来週・過去は変えない

### 12.1〜12.7 からの変更

| 項目 | 変更 |
|---|---|
| FR-12-3（意図は3種類だけ） | 会話の経路では、12.9 の操作で表せるものはすべて受ける |
| FR-12-5（目標の週合計は変えない） | 会話の経路では、利用者が減らすと言ったとき（skip・shorten）は減らしてよい。代わりに警告を出す（12.11） |
| C-16（文章はテンプレートだけ） | 会話の経路では、言い回しは LLM。数字はコードの値だけ（12.12） |
| C-12（今日だけ） | 変えない |

## 12.9 操作（`lib/schemas.ts` に足す）

LLM が返す形。OpenAI の strict JSON Schema に合わせて、**判別共用体にせず、使わない項目は null・空配列**にする。

```ts
// ---------- 再計画（会話。plans-replan 12.8〜） ----------
export const ReplanOpTypeSchema = z.enum([
  "add_event",    // 新しい予定を入れる（飲み会・散歩・自習など、タスク一覧にないもの）
  "add_rest",     // 休憩・仮眠を入れる
  "delay",        // 今の予定が長引く・遅れる（now から minutes 分ふさぐ）
  "reorder",      // 今日の残りのタスクの順番を変える
  "shorten",      // タスクを短くする
  "postpone",     // タスクを今日から外し、明日以降に回す
  "skip",         // タスクを今週はやめる
  "pull_forward", // 明日以降のタスクを今日やる
  "move_to_day",  // タスクを指定の日に移す
  "tired_plan",   // 疲れたときの標準の組み直し（12.4 A の Engine）。1案に単独で入れる
]);

export const ReplanOpLlmSchema = z.object({
  op: ReplanOpTypeSchema,
  item_id: z.string().nullable(),      // shorten・postpone・skip・pull_forward・move_to_day
  item_ids: z.array(z.string()),       // reorder（先にやる順）
  title: z.string().nullable(),        // add_event・add_rest
  start: z.string().nullable(),        // "HH:MM" または "now"（add_event・add_rest）
  end: z.string().nullable(),          // "HH:MM"（add_event）
  minutes: z.number().int().nullable(),// add_event（end がないとき）・add_rest・delay・shorten（短くした後の長さ）
  date: z.string().nullable(),         // "YYYY-MM-DD"（postpone の希望・move_to_day）
  position: z.enum(["first", "last"]).nullable(), // pull_forward
});

export const ReplanChatLlmSchema = z.object({
  reply_type: z.enum(["proposal", "question", "select", "discard", "chat"]),
  options: z.array(z.object({ label: z.string(), ops: z.array(ReplanOpLlmSchema) })),
  select_index: z.number().int().nullable(), // select のとき。1始まり
  text: z.string().nullable(),               // question・chat のときの返事
  fatigue: LevelSchema.nullable(),           // 発言から分かる疲れ（分からなければ null）
});

export const ReplanChatMessageLlmSchema = z.object({ message: z.string() });

// API
export const ReplanChatTurnSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string() });
export const ReplanChatRequestSchema = z.object({
  date: z.string(),
  text: z.string().min(1).max(500),
  history: z.array(ReplanChatTurnSchema).max(20),   // 今回の発言は含めない。古い順
  open_proposal_ids: z.array(z.string()).max(3),    // 画面に出ている案（表示の順）
});
export const ReplanChatProposalSchema = ReplanProposalSchema.extend({
  label: z.string(),             // 「仮眠してから続ける」など
  warnings: z.array(z.string()), // 「今週のTOEIC学習が40分足りなくなります」など（12.11）
});
export const ReplanChatResponseSchema = z.object({
  message: z.string(),
  proposals: z.array(ReplanChatProposalSchema).max(3),
  selected_proposal_id: z.string().nullable(), // select のとき
  discarded: z.boolean(),                      // discard のとき（画面は出ている案を消す）
  source: z.enum(["llm", "fallback"]),         // fallback ＝ 12.2 の経路で作った
});
```

- 会話の経路の `ReplanProposal.intent` は、互換のために `{ type: "preference_change", fatigue: <fatigue>, task_changes: [], new_fixed_events: <足した予定>, preference_changes: [<label>] }` を入れる（画面では使わない）。`tired_plan` の案は Engine の intent をそのまま使う
- 型（`z.infer`）：`ReplanOpLlm`・`ReplanChatLlm`・`ReplanChatRequest`・`ReplanChatProposal`・`ReplanChatResponse`

## 12.10 操作の当てはめ（`lib/server/replan-chat/apply-ops.ts`。純粋関数）

```ts
applyOps(input: {
  context: PlanningContext;   // 12.2 の 6 で作ったもの（locked_items 込み）
  beforeDays: { date: string; items: PlannedItem[] }[]; // 7日分。表示用の計算（11.3）をかけ、reason_code を付けたもの（12.2 の engineBeforeDays と同じ）
  ops: ReplanOpLlm[];
  newId: () => string;
}): {
  result: Extract<EngineReplanResult, { ok: true }>; // buildReplanRows() にそのまま渡せる形
  newFixedEvents: FixedEvent[];
  opErrors: string[];           // 当てはめられなかった操作（日本語。LLM に返す）
  unplaced: { task_id: string; title: string; minutes: number; deadline_at: string | null }[];
  skippedGoalMinutes: number;   // skip・shorten で今週から外した目標タスクの分
}
```

`cut` ＝ `ceilToMinutes(context.now, 5)`。時刻はすべて5分単位。`dayEnd` ＝今日の now 以降で最初の睡眠の開始（なければ翌日 0:00）。

### 手順

1. **今日の項目を分ける**
   - **動かさない（アンカー）**：`locked`、kind が sleep・fixed・travel、`start_at < cut` の項目（進行中を含む）
     - now をまたぐ自由時間・バッファ（locked: false）は、`end_at = cut` に縮めて残す（id は同じ）
   - **並べ直す（キュー）**：locked でない `kind: task` で `start_at ≥ cut`。開始時刻の順
   - **作り直す**：locked でない free・buffer で `start_at ≥ cut`（消して、5 で作り直す。バッファの候補タスクは消えてよい）
2. **操作を順に当てはめる**。当てはめられない操作は `opErrors` に理由を足して飛ばす

   | op | 処理 | opErrors になるとき |
   |---|---|---|
   | add_event | 開始＝`now` なら cut、そうでなければその時刻（5分に切り上げ）。終わり＝end → start＋minutes → start＋60分（仮置き。C-10 の一文を warnings に）。FixedEvent（category other・location null・recurrence null）を作り、アンカー（kind fixed・fixed_event_id・fixed_category other）を足す。reason「{HH:MM}からの予定を入れました」 | 開始 < cut、開始 ≥ 終わり、終わり > dayEnd、アンカー（sleep・fixed・travel・locked）と重なる →「{title}（{開始}〜{終了}）と重なるため入れられません」 |
   | add_rest | add_event と同じ時刻の決め方。minutes は既定20・10〜90に収める。アンカー（kind free・title は「仮眠」「休憩」など LLM の値、既定「休憩」）。reason「少し休んで、回復してから続けます」 | add_event と同じ |
   | delay | minutes を5〜180に収め、cut から minutes 分のアンカー（kind free・title「前の予定の延長」）を足す | なし |
   | reorder | item_ids のうちキューにあるものを、その順でキューの先頭に移す | キューにある id が1つもない |
   | shorten | キューの項目の長さを minutes（5分に切り下げ）にする | キューにない、minutes < 10、今の長さ以上 |
   | postpone | キューから外し、溢れ（date の希望付き）に入れる | キューにない |
   | skip | キューから外す。締切が日曜以前のタスクは postpone と同じにする（締切を守る）。それ以外は今週から外す（目標タスクなら `skippedGoalMinutes` に足す） | キューにない |
   | pull_forward | 明日〜日曜の locked でない task 項目を外し（その場所は自由時間）、キューの先頭（first）か末尾（last。既定）に入れる | その id が明日以降にない |
   | move_to_day | キューか明日以降の task 項目を外し、溢れ（その日に固定）に入れる | id がない、date が明日〜日曜でない、締切の日より後 |
   | tired_plan | ここでは扱わない（12.11 で Engine を呼ぶ）。ほかの操作と同じ案にあれば `opErrors` | 常に（混ざったとき） |

3. **今日の空き**：[cut, dayEnd) からアンカーを除いた区間
4. **キューを並べる**（順番は変えない）
   - 前から順に、直前に置いたタスクの終わり（＋`min_buffer_minutes` のバッファ）以降で、入る最初の空きに置く
   - タスクの後ろには、空きに余裕があれば `min_buffer_minutes` のバッファ（kind buffer）を置く。次がアンカーならバッファが短くてもよい
   - 今日のタスク合計（完了済みを含む）が `daily_work_limit_minutes` を超える、置くと今日のバッファ＋自由時間の合計が `min_daily_buffer_minutes` を下回る（Validator の BUFFER_SHORTAGE。「予定のずれに備える時間」を守るため）、または入らない → 溢れに入れる。明日以降に置くとき（6）も同じ2つを守る
   - 分割はしない
5. **今日の残りの空き**はすべて自由時間（kind free・title「自由時間」）。隣り合う自由時間は1つにまとめる
6. **溢れを明日以降に置く**：締切の早い順 → 締切なし（目標・任意）の順
   - 候補の日：date の指定があればその日だけ。なければ明日〜日曜のうち、終わりが `deadline_at` 以前になる日
   - その日の自由時間で、「（直前がタスクならバッファ）＋タスク＋バッファ」が入る最初のもの。その日のタスク合計 ≤ `daily_work_limit_minutes`
   - 自由時間を [自由時間][バッファ][タスク][バッファ][自由時間] に分ける（0分の項目は作らない）。reason「{曜日}に回しました」
   - 置けない → `unplaced`
7. **id**：中身も時刻も変わらない項目は元の id。変わった項目と新しい項目は `newId()`。`reason_code` は変わらない項目なら元の値、新しい項目は `FIXED_EVENT_ADDED`・`REST`・`USER_POSTPONED`・`USER_SHORTENED`・`BUFFER_MERGED`（自由時間）・null（バッファ）
8. **変更点**：`ReplanDiffBuilder`（`lib/planning/diff.ts`）で記録する
   - 予定・休憩を足した → added。今日の中で時刻が変わったタスク → moved（moved_to_date null）。短くした → shortened。他の日へ → moved（moved_to_date）。skip → removed。自由時間・バッファの変化は記録しない
9. **結果**：`updated_days` は今日と、項目が変わった日。`proposal` の before・after は今日。`summary_message` は空文字（12.12 で入れる）

### 細かい決まり（2026-10-02 決定）

1. **「now」と進行中のアンカー**
   - add_event・add_rest の start が `"now"` で、cut を含む進行中のアンカーが **task** のとき：そのタスクを now で切る
     - 前半：同じ id・同じ start_at・`end_at = context.now`・locked・completed（FR-12-4 の例外と同じ形）
     - 後半（end_at − cut の分）：新しい id でキューの先頭に入れる
     - 切ったタスクの id は、`validatePlan` の `allowedInProgressTaskSplitIds` に渡す
   - 進行中のアンカーが fixed・travel・sleep のとき：`"now"` はそのアンカーの終わり
   - delay：進行中のアンカー（種類を問わない）の終わりから minutes 分ふさぐ。なければ cut から。次のアンカーと重なる分は手前で切る
   - add_rest・add_event が（切った後も）アンカーと重なるときは opErrors
2. **前へ詰めない**：キューのタスクは元の開始時刻より前には置かない。reorder・pull_forward で先頭に来たものと、切ったタスクの後半は cut（か直前のアンカーの終わり）から置く
3. **作業の終わり**：タスクとバッファは、その日の就寝の30分前（`replan()` の workEnd と同じ。睡眠 0:00 なら 23:30）までに置く
4. **溢れの並び順**：締切の早い順 → 締切なし。同じなら元の開始時刻の順。date の指定があっても締切は守り、守れなければ unplaced
5. **バッファ**：タスクの後ろのバッファは min(`min_buffer_minutes`, 次のアンカー・作業の終わりまで)。0分なら作らない
6. **id**：他の日の自由時間を分けた項目は、すべて新しい id（元の自由時間はなくなる）
7. **reason と変更点**
   - 今日の中で時刻だけ変わったタスク：元の reason・reason_code のまま、新しい id。changes に moved（moved_to_date null）
   - 他の日に回したタスク：理由によらず `USER_POSTPONED`
   - delay：added。reason「前の予定が延びた分をあけました」・reason_code null
   - pull_forward：今日の changes に moved（before＝明日以降の元の項目、after＝今日の項目、moved_to_date＝今日）。元の日には記録しない
   - unplaced：今日の changes に removed。締切が来週以降なら `NEXT_WEEK`、締切がなければ reason「{タスク名}は今週に入りませんでした」・reason_code null

## 12.11 検査と LLM とのやり取り（`lib/server/replan-chat/run.ts`）

### 1つの案を検査する（`checkOption`）

1. `tired_plan` の案：12.2 の 6・7 と同じく `replan(context, beforeDays, { type: "state_change", fatigue: <fatigue か "high"> })` を呼ぶ。`ok: false` なら、その reason を errors にする
2. それ以外：`applyOps()` → `validatePlan(context ＋ 足した予定, after の7日分, "replan", { before: beforeDays })`
3. 結果を分ける
   - **errors**（案を捨てる・LLM に返す）：`opErrors`、Validator の errors（下の例外を除く）、締切が日曜以前の `unplaced`（「{title}が締切（{M/D}）に間に合いません」）
   - **warnings**（案は出す・利用者に見せる）：
     - Validator の `GOAL_HOURS_MISMATCH` → errors から外し、「今週の{目標名}が{不足分}分足りなくなります」（不足分＝想定 − 実際）
     - 締切がない・来週以降の `unplaced` →「{title}は今週に入りませんでした」
     - 終わりの時刻を仮置きした予定 → C-10 の一文

### 1ターンの流れ

```text
1. 12.2 の 1・2・5・6 と同じ準備（今日だけ・有効な計画・Before・PlanningContext）。lib/server/replan-base.ts に切り出して両方の route で使う
2. LLM_MODE=off → 12.2 の経路（fallback）
3. 計画の呼び出し（12.13 のプロンプト①）
     LlmError（1回目）→ 12.2 の経路（fallback）
4. reply_type ごと：
     chat・question → message = text、proposals = []
     select → open_proposal_ids[select_index − 1] があれば selected_proposal_id に。message は「案{n}にしますね。よければ『この計画にする』を押してください。」
     discard → open_proposal_ids の pending を discarded にし、discarded = true。message「わかりました。今の予定のままにします。」
     proposal → 5 へ
5. 各案を checkOption。1つでも通れば 7 へ
6. 全部だめ → 案ごとの errors を feedback に入れて、もう一度 3（最大2回。2回目以降の LlmError は 8 へ）
7. 通った案だけを保存（12.2 の 8・9 と同じ。案ごとに replan_proposals の1行）→ 説明の呼び出し（12.12）→ 返す
8. 最後まで通らない → 説明の呼び出しに「できなかった理由」を渡し、できる範囲を伝える文を作る。proposals = []
```

- `fatigue` が high・medium なら、12.2 の 6 と同じく今日のチェックインの fatigue を更新する
- 時間の上限：1ターン全体で15秒。超えそうなら、その時点で通っている案で返す（なければ 8 の文、それも間に合わなければ fallback の文）
- LLM のログは name・所要時間・成否・エラーの種類だけ（発言は出さない）

## 12.12 説明の文章と数字の検査（`lib/llm/replan-chat-message.ts`）

1. **facts を作る**（コード）：案ごとに
   - `label`
   - 操作の要約：コードで作る文（「19:00〜21:00 に飲み会を入れる」「TOEICリスニング演習を水曜に回す」）
   - 影響：`computeReplanImpact(proposal, tasks)`（`lib/replan-impact.ts`）の今日のタスク増減・自由時間の増減・他の日の移動・締切
   - warnings
2. **説明の呼び出し**（12.13 のプロンプト②）→ `message`
3. **数字の検査**：`message` の中の「N分」「N時間」「HH:MM」「M/D」「N時」を取り出し、facts と利用者の発言に出てくる数字に**ないもの**が1つでもあれば、テンプレートに替える
   - テンプレート：「案を{n}つ用意しました。」＋「案1：{label1}、案2：{label2}」＋warnings を1文ずつ。案が1つなら「{label}の案を用意しました。」
4. LLM が失敗したときもテンプレート
5. 返す `summary_message`（案ごと）も、その案の操作の要約＋warnings で作る（画面の変更点の上に出す）

## 12.13 プロンプト

### ① 計画（`lib/llm/replan-chat.ts`。name `replan_chat`、temperature 0.3、timeout 8秒、retries 0）

system：

```text
あなたは大学生の予定を一緒に調整する秘書です。利用者の発言と今日の予定を読み、予定の変え方を「操作」で提案します。
時刻の計算・並べ直し・検査はプログラムが行います。あなたは「何をどう変えるか」だけを決めてください。

# reply_type
- "proposal"：予定を変える案を options に1〜3個入れる
- "question"：何をしたいのか本当に決められないときだけ。text に短い質問を1つ（答えの例を2つ添える）
- "select"：利用者が出ている案を選んだ（「案2で」「2つ目がいい」「それでお願い」）。select_index に1始まりの番号（open_options の index）
- "discard"：利用者が出ている案をやめた（「やっぱりナシ」「元に戻して」「今のままでいい」）
- "chat"：予定を変えない雑談・お礼・前向きな発言。text に短い返事
迷ったら question より proposal（たたき台）を優先する。

# 操作（op）。使わない項目は null か空配列
- add_event：新しい予定を入れる（飲み会・散歩・自習など、今日のタスクにないこと）。title、start（"HH:MM" か "now"）、end（"HH:MM"）か minutes。終わりが分からなければ end も minutes も null
- add_rest：休憩・仮眠を入れる。start（ふつうは "now"）、minutes（仮眠は20、休憩は30が目安）、title（「仮眠」「休憩」）
- delay：今の予定が長引く・電車が遅れるなど。minutes
- reorder：今日の残りのタスクの順番を変える。item_ids に先にやるものから
- shorten：タスクを短くする。item_id、minutes（短くした後の長さ）
- postpone：タスクを今日から外して別の日に回す。item_id、date（希望がなければ null）
- skip：タスクを今週はやめる。item_id
- pull_forward：明日以降のタスクを今日やる。item_id、position（"first" か "last"）
- move_to_day：タスクを指定の日に移す。item_id、date
- tired_plan：疲れ・眠い・だるい・やる気が出ないときの「今夜を軽くする」標準の組み直し。この操作は1つの案に単独で入れる

# 案の作り方
- 案が複数なら、考え方を変える（例：「仮眠してから続ける」と「今夜は軽めにする」）。label は12文字以内の日本語
- 体調・気分（疲れた・眠い・だるい・やる気が出ない・頭が回らない）：tired_plan の案と、add_rest の案の2つを基本にする。fatigue に疲れの度合いを入れる（はっきり疲れている "high"、少し・気分が落ちている "medium"）
- 予定が入った：add_event だけでよい。重なるタスクはプログラムが後ろに回す
- 「今から〜したい」：今日・明日以降のタスクにあれば pull_forward（position "first"）か reorder。なければ add_event（start "now"）
- 特定のタスクを明日に・後で（「ワンチャン明日でよくね」「ESは明日でいいや」）：postpone。タスク名が省略されていても today の title から選ぶ
- 無理な要求（残り時間より多いタスクを全部・睡眠を削る・休憩をなくす）：そのままの案は作らない。締切が近い順・重要度の高い順に残し、残りを postpone した「できる範囲で最大」の案を出す
- 睡眠・固定予定・移動・終わった予定・進行中の予定は変えられない（そのための操作もない）
- now が 23:00 以降なら、今日に新しいタスクを入れず postpone を中心にする

# 守ること
- item_id は today・later_tasks にある id だけを使う。作らない
- 時刻は利用者が言った時刻か "now" だけを書く。自分で計算した時刻を書かない
- feedback があれば、前の案がプログラムの検査で通らなかった理由。理由を読んで直した案を出す
- history で前に出した案や利用者の希望を踏まえる
```

user（JSON。キーは英語、値は日本語のまま）：

```json
{
  "now": "18:00", "date": "2026-10-05", "weekday": "月",
  "message": "<今回の発言>",
  "history": [{ "role": "user", "text": "..." }, { "role": "assistant", "text": "..." }],
  "open_options": [{ "index": 1, "label": "仮眠してから続ける" }],
  "checkin": { "mood": "medium", "fatigue": "high", "concentration": "low" },
  "today": [
    { "id": "...", "kind": "task", "title": "TOEICリスニング演習", "start": "18:00", "end": "19:00",
      "can_change": true, "deadline": null, "goal": true, "importance": "high", "concentration": "high" },
    { "id": "...", "kind": "fixed", "title": "夕食", "start": "19:00", "end": "19:45", "can_change": false }
  ],
  "later_tasks": [{ "id": "...", "title": "ES作成（企業A）", "date": "2026-10-06", "start": "18:00", "end": "19:00", "deadline": "10/12" }],
  "goals": [{ "name": "TOEIC学習", "week_target_minutes": 360 }],
  "settings": { "sleep_start": "00:00", "min_buffer_minutes": 15, "daily_work_limit_minutes": 360 },
  "feedback": [{ "label": "...", "errors": ["夕食（19:00〜19:45）と重なるため入れられません"] }]
}
```

- `today` は今日の now 以降（進行中を含む）。free・buffer は送らない（空きはプログラムが作る）
- `later_tasks` は明日〜日曜の locked でない task 項目だけ
- `history` は直近10件まで

### ② 説明（`lib/llm/replan-chat-message.ts`。name `replan_chat_message`、temperature 0.5、timeout 6秒、retries 0）

system：

```text
あなたは予定を一緒に調整する秘書です。プログラムが作った案の内容（facts）を、利用者に短く伝えます。
- 2〜3文。最初に気持ちへの一言（疲れていれば労う。予定が入ったなら軽く受け止める）、次に案の要点
- 案が複数なら「案1は〜、案2は〜」と1文ずつ
- 利用者の口調に合わせる（くだけた発言にはやわらかく。ただし敬語は崩しすぎない）
- 数字（分・時間・時刻・日付）は facts にあるものだけを、そのまま書く。足し算・言い換え・丸めをしない
- warnings があれば必ず1文で伝える
- failed があるときは「できません」で終わらせず、できる範囲を伝える
- 利用者の選択を否定しない。説教しない
```

user：`{ "message": "<今回の発言>", "options": [{ "label", "summary": ["..."], "today_task_minutes_delta", "today_free_minutes_delta", "other_days": ["水曜：TOEICリスニング演習 +40分"], "deadline": "ok" | "late" | "none", "warnings": [] }], "failed": ["..."] }`

## 12.14 API

| API | 変更 |
|---|---|
| ★`POST /api/plans/replan/chat` | 新規。`ReplanChatRequestSchema` → `ReplanChatResponseSchema`。12.11 の流れ |
| `POST /api/plans/replan` | 変えない（fallback と `LLM_MODE=off` で使う）。準備の部分だけ `lib/server/replan-base.ts` に切り出す |
| `POST /api/plans/replan/accept` | 変えない。案が複数でも、`apply_replan` が同じ日の他の pending を discarded にする |

- エラー：`date` が今日でない → `{ message: "今日の予定だけ変更できます。", proposals: [], ... }`。有効な計画がない → 409（今と同じ）
- `discard` のために `discardReplanProposals(supabase, ids)`（`lib/server/repositories/replan-proposals.ts`。pending だけを discarded に）を足す

## 12.15 受け入れテスト

単体（OpenAI は呼ばない。`callStructured` をモック）：

- [ ] applyOps：バランスプラン・now 10/5 18:00 で、次のどれも Validator の errors が0件（`LOCKED_ITEM_CHANGED` なし）
  - add_event 20:00〜22:00 →重なるタスクが後ろか明日以降に回る
  - add_rest now 20分 → 今日のタスクが20分以上後ろにずれ、入らない分は明日以降
  - delay 30 → 同上
  - reorder・shorten・postpone（date 指定あり／なし）・pull_forward（明日のタスクを今日の先頭に）
- [ ] add_event 19:00〜21:00 → 夕食と重なり opErrors
- [ ] skip（目標タスク）→ errors 0、warnings に「今週のTOEIC学習が{N}分足りなくなります」（N は外した分）
- [ ] 今日のタスクを全部 pull_forward → 入らない分は溢れ、締切のあるものが置けなければ errors
- [ ] tired_plan が他の操作と同じ案にある → errors
- [ ] run：1回目の LLM が存在しない item_id → feedback にその理由が入り、2回目の正しい案が返る
- [ ] run：select・discard・chat・question の形
- [ ] run：1回目の LlmError → source "fallback"（12.2 の経路の提案）
- [ ] 数字の検査：facts にない「45分」を含む文 → テンプレートになる

手動（`LLM_MODE=on`、10/5 18:00、TOEIC バランスの計画）：`docs/scenarios/replan-chat.md` の 1〜6、`edge-cases.md` の 2〜4、`time-rules.md` の 2
