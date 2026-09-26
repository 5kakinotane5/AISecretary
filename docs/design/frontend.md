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
| `/today` | `fetchDemoNow()` → `fetchClock()`。`demo_mode` のときだけ `DemoNowChip`。`has_plan: false` のとき、空の表示に「目的地を相談する」ボタン（→ `/interview`。副ボタンの見た目）を足す |
| `/calendar` | `fetchDemoNow()` → `fetchClock()`（`now` だけ使う） |
| `/replan` | `fetchDemoNow()` → `fetchClock()`。18:00 への繰り上げ（`setDemoNow`）と「デモのため、時刻を18:00に進めました」は `demo_mode` のときだけ。チップも `demo_mode` のときだけ |
| `/settings` | 時刻は `fetchClock()`。「デモ用」の欄（時刻の切り替え・リセット）とチップは `demo_mode` のときだけ。（**対応済み**）`goal` が null のとき、「目的地」の欄に「まだ目的地がありません」（`SETTINGS_LABELS.noGoal`）と「新しい目的地を相談する」ボタンだけを出す |
| `/plans` | （**対応済み**）比較表の目標の行の見出しに `settings.goal?.task_name ?? SCREEN_LABELS.goal`（「目的地」）を渡す |
| `/interview` | 「スケジュール作成」が失敗したら、`ApiError.message`（422 なら計画が作れない理由）をボタンの上に出す |
| `lib/labels.ts` | `REPLAN_QUICK_REPLIES` を「今日は疲れた」「20時から1時間予定が入った」「今日はもう勉強したくない」の3つにする（対応していない「今から30分だけ何かやりたい」は外す）。上の新しい文言を足す |

### 14.3 モックへの先行追加（担当A が Day 1 の最初に行う）

画面の変更を本番の API を待たずに進めるため、モックにも次を足す。

- `GET /api/clock`：`{ now: demo_now, demo_mode: true }`
- `SettingsResponseSchema.goal` の nullable 化（**対応済み**。モックは今までどおり G1 を返す）

### 14.4 受け入れテスト（手動・390px）

- [ ] `DEMO_MODE` を外すと、チップ・デモ用の欄・18:00 の繰り上げが出ず、どの画面もエラーにならない
- [ ] リセット直後に `/settings` を開くと、目的地の欄が空の表示になり、500 にならない
- [ ] 計画のない週の `/today` に「目的地を相談する」が出る
- [ ] 計画が作れないとき、`/interview` に理由が出る
