# 設計書：画面の変更（14章）

> 設計書（`docs/design/`）の一部。目次・章とファイルの対応は [README.md](README.md)。章番号は設計書全体で共通。

## 14. 画面の変更（担当C）

API の形がモックと同じものは、画面を変えない。変えるのは次だけ。

### 14.1 `lib/api.ts`

| 変更 | 内容 |
|---|---|
| エラーの読み取り | `!response.ok` のとき、本文を `ApiErrorSchema.safeParse` し、成功すれば `new ApiError(status, error.code, error.message)`。失敗すれば今の文言。`ApiError` に `code` を足す |
| 401 | `ApiError` の status が401なら `window.location.assign("/login")`（`mockLogin` の呼び出しは除く） |
| ★`fetchClock()` | `GET /api/clock` → `ClockResponseSchema`（`{ now, demo_mode }`） |
| 残す | `fetchDemoNow`（使わなくなるが削除はしない）、`setDemoNow`・`resetMock`（デモモードの画面だけで使う） |

### 14.2 画面ごと

| 画面・部品 | 変更 |
|---|---|
| `/today` | `fetchDemoNow()` → `fetchClock()`。`demo_mode` のときだけ `DemoNowChip`。`has_plan: false` のとき、空の表示に「目標を相談する」ボタン（→ `/interview`。副ボタンの見た目）を足す |
| `/calendar` | 表示名を「予定表」に変更。見出しと月／週／日の切り替え・期間移動を上部約20%にまとめて固定する |
| `/replan` | `fetchDemoNow()` → `fetchClock()`。18:00 への繰り上げ（`setDemoNow`）と「デモのため、時刻を18:00に進めました」は `demo_mode` のときだけ。チップも `demo_mode` のときだけ |
| `/settings` | `goalTitle` を「長期目標」にし、先頭に表示。睡眠時間と1日の作業上限を `PATCH /api/settings` で編集し、最低バッファ量は「予定のずれに備える時間（最低）」として固定表示。場所・移動時間・有効な計画は変更しない。長期目標の欄の「新しい目標を相談する」（→ `/interview`）は目立たないテキストリンクにする。「デモ用」の欄（時刻の切り替え・リセット）とチップは `demo_mode` のときだけ |
| `/plans` | （**対応済み**）比較表の目標の行の見出しに `settings.goal?.task_name ?? SCREEN_LABELS.goal`（「長期目標」）を渡す |
| `/interview` | 「スケジュール作成」が失敗したら、`ApiError.message`（422 なら計画が作れない理由）をボタンの上に出す |
| `lib/labels.ts` | `REPLAN_QUICK_REPLIES` を「今日は疲れた」「20時から1時間予定が入った」「今日はもう勉強したくない」の3つにする（対応していない「今から30分だけ何かやりたい」は外す）。上の新しい文言を足す |

`/today` は「今日の予定」とし、現在時刻を含む行（該当がなければ次の予定）へ初期スクロールする。日付・達成率の2行のヘッダーを上部に固定し（高さは中身と余白で決める）、タスク枠のチェックは `PATCH /api/plan-items/completion` で保存する。完了率は枠数で計算し、未チェック枠を時刻だけで完了扱いしない。

#### 自由時間の表示（「余白」を使わない）

- **画面上はすべて「自由時間」**。内部の buffer は自由時間として表示し、隣り合う自由時間は1つにまとめる（design-spec.md 4章）
- **Engine・`/plans` の内部値では buffer と free を分けたまま**。`kind`、`PlanSummary` の `buffer_hours`／`free_hours`、DB、API、最低バッファの制約は変えない。まとめるのは表示の直前だけ
- まとめは `lib/schedule.ts` の `mergeFreeTime(items)`（純粋関数）で行う
  - `kind: "buffer"` を表示上 `kind: "free"`・タイトル「自由時間」にする
  - 時刻順で、前の `end_at` ＝ 次の `start_at` かつ `location_id` が同じ free 同士を1つにする。`id`・`start_at` は最初、`end_at` は最後のもの
  - 候補タスク（`suggested_task_id`）は `suggested_task_ids` に重複なく集め、`suggested_task_id` には最初の1件を残す。`reason` は重複を除いて改行でつなぐ
- 使う場所
  - `Timeline`（`/today`、`/calendar` の日表示、`/replan` の変更前後、`/plans` のプレビュー）：描画の前に `mergeFreeTime` を通す。見た目は free（緑・`Coffee`）。候補タスクがあれば「候補：メール返信」をブロックに出し、タップで詳細シートを開く。候補のない自由時間はタップできない（今の free と同じ）
  - `ItemBlock`・`ItemDetailSheet`・`ChangeList`：buffer の表示名は「自由時間」
  - `/calendar`：`WeekConditionCard` は「タスク・自由時間」の2本（自由時間＝buffer＋free の合計）。`WeekGrid` のブロックも `mergeFreeTime` を通し、凡例から「余白」を外す。列の読み上げは「自由時間45分」
  - `/plans` の `PlanCompareTable`：「自由時間」1行（`buffer_hours + free_hours`）
  - `/settings`：`min_buffer_minutes` の表示名は「予定のずれに備える時間（最低）」。中身はバッファだけなので「自由時間の最低量」にはしない

#### `/today` の「今日の調子」（チェックイン）

- 位置はヘッダーの下、「今日の予定」カードの上。ヘッダーは変えない
- 1日1回だけ入力する。読み込みは `/today` の他のデータと並列に `GET /api/checkin?date=<今日>`（`fetchCheckin`）
- **確定済み**＝今日の checkin があり、`mood`・`fatigue`・`concentration` が3つとも `null` でない。確定済みでなければ入力カード、確定済みなら1行の表示を出す
- ロックは画面側だけで行う。API（`POST /api/checkin`）は同じ日を上書きできるまま（`/replan` の `state_change` がサーバーで `fatigue` を更新するため）

  | 項目 | low | medium | high |
  |---|---|---|---|
  | 気分 `mood` | 落ち込み気味 | ふつう | 良い |
  | 疲労 `fatigue` | 元気 | 少し疲れた | 疲れている |
  | 集中 `concentration` | できなさそう | ふつう | できそう |

  入力カードのアイコン（lucide-react。絵文字は使わない）：

  | 項目 | low | medium | high |
  |---|---|---|---|
  | 気分 `mood` | `Frown` | `Meh` | `Smile` |
  | 疲労 `fatigue` | `BatteryFull` | `BatteryMedium` | `BatteryLow` |
  | 集中 `concentration` | `SignalLow` | `SignalMedium` | `SignalHigh` |

- **入力カード（未確定のとき）**：見出し「今日の調子は？」。3行（気分・疲労・集中）で、各行は左にラベル、右に3つの小さな選択肢（`components/common/segment.ts` のセグメントを低くしたもの）。各選択肢は「アイコン（18px）＋その下に小さな文字（11px。上の表の文言）」。1行の見た目の高さは48px（内側のボタンは40px）で、タップ領域は行の間の余白まで広げて44px以上にする。選択中はセグメントの見た目（`data-active`）
  - 一部だけ入っている（`/replan` で `fatigue` だけ入った等）ときは、入っている値を初期選択にする。未入力の項目は何も選ばれていない状態
  - 選んでもすぐには送らない。3つすべて選ぶと「決定」が押せるようになる
  - 「決定」で `POST /api/checkin`（`saveCheckin`）を1回だけ呼び、3つまとめて送る。送信中は全体を押せなくする。失敗したら一文のエラーを出し、選択は残す
- **確定後の1行表示**：見出し「今日の調子」の右に、総合の顔のアイコン（20px）と一言だけを出す。項目ごとのアイコン（電池・電波など）や文字の選択肢は出さない。折り返さず1行に収める。ボタンにしない（押しても何も起きない）。高さは32px。再計画で `fatigue` が変わったときは、読み込み直したときに新しい値を出す
  - 総合の判定は `lib/checkin.ts` の `overallCondition`。調子が悪い側（下の「AIに相談する」と同じ条件：`mood` low、`fatigue` medium・high、`concentration` low。`isUnwellLevel` で `consultTextFor` と共用）の数で決める

    | 総合 | 条件 | アイコン | 一言（`CHECKIN_LABELS.overall`） |
    |---|---|---|---|
    | `tired` | `fatigue` が high、または悪い側が2つ以上 | `Frown` | お疲れ気味 |
    | `normal` | 悪い側が1つ | `Meh` | ふつう |
    | `good` | 悪い側が0 | `Smile` | 元気 |

  - `tired` のときだけ、アイコンと一言を注意の色（`--deadline-fg`。締切バッジと同じく赤は使わない）にする。それ以外は通常の文字色（`--foreground`）
  - 3項目の中身は、アイコンと一言のまとまりに `role="img"`・`aria-label`・`title` で付ける（例「今日の調子：お疲れ気味（気分 落ち込み気味・疲労 疲れている・集中 できそう）」）
- **チェックインを入れても計画は自動では作り直さない（FR-08-14）**。このページで「決定」した直後だけ、次のどれかなら1行表示の下に「今日の予定を軽くしますか？」と「AIに相談する」ボタンを出す：`fatigue` が medium・high、`concentration` が low、`mood` が low。出すのは、今日に計画があり（`day.has_plan`）、now 以降に未完了のタスク枠があるときだけ。一時的な表示で、再読み込みしたら出さない
- 「AIに相談する」は `/replan?text=<文>` へ移る。文は優先順に1つ：`fatigue` high →「今日は疲れた」、medium →「少し疲れた」、`concentration` low →「集中できない」、`mood` low →「今日はちょっとやる気ないです」（どれも 12.3.2 のキーワードで `state_change` になる）

#### `/replan` の `?text=` による自動送信

- 時刻の読み込み（18:00 への繰り上げを含む）が成功してから、`text` があれば1回だけ送る（ユーザーの吹き出しも出す）。Strict Mode で2回送らないよう ref で守る
- 送ったら `router.replace("/replan")` でクエリを消す（再読み込みで再送しない）
- `useSearchParams` は Suspense で囲む。`text` がないときの動きは変えない。計画を変えるのは、提案を見て「この計画にする」を押したときだけ

#### `/replan` の「数字で見る変化」

提案が出たら、AI の一文の下・変更点（`ChangeList`）の上に、提案の影響を数字で出すカード（`components/replan/ReplanImpact.tsx`）を置く。画面だけで計算し（`lib/replan-impact.ts` の `computeReplanImpact`）、API・Engine・スキーマは変えない。

```
今日      タスク −40分 ／ 自由時間 +40分
ほかの日  10/6（火） +35分 ES作成（企業A）
          10/11（日） +40分 TOEIC リスニング演習
締切      すべて間に合います ✓
```

- **今日**：`proposal.after` と `proposal.before` の差。タスクは `kind: task` の合計、**自由時間は内部の `kind: buffer` と `kind: free` を合わせたもの**（合計は `lib/schedule.ts` の `sumFreeTimeMinutes`。上の「自由時間の表示」と同じ）。0分の項目は出さない
- **ほかの日**：日付ごとに、その日に増えたタスクの時間とタスク名。`other_day_changes` を正とし、`changes` の `moved_to_date`（今日以外）は、同じタスク項目・同じ日の `other_day_changes` がないときだけ足す（二重に数えない）。変更がなければ「ほかの日への影響はありません」
- **締切**：他の日へ移したタスクのうち `deadline_at` があるものについて、移した先の日 ≤ 締切の日かを確かめ、「すべて間に合います」「締切のあるタスクは動いていません」「間に合わないタスクがあります（タスク名）」のどれかを出す。タスク一覧（`GET /api/tasks`）が取れなかったときは、この行だけ出さない
- 増減は「＋／−」の文字で出す（色だけに頼らない）

### 14.3 モックへの先行追加（担当A が Day 1 の最初に行う）

画面の変更を本番の API を待たずに進めるため、モックにも次を足す。

- `GET /api/clock`：`{ now: demo_now, demo_mode: true }`
- `SettingsResponseSchema.goal` の nullable 化（**対応済み**。モックは今までどおり G1 を返す）

### 14.4 受け入れテスト（手動・390px）

- [ ] `DEMO_MODE` を外すと、チップ・デモ用の欄・18:00 の繰り上げが出ず、どの画面もエラーにならない
- [ ] リセット直後に `/settings` を開くと、長期目標の欄が空の表示になり、500 にならない
- [ ] 計画のない週の `/today` に「目標を相談する」が出る
- [ ] 計画が作れないとき、`/interview` に理由が出る
