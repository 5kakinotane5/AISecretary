# 設計書：分担・順番・完了の判定（16章）

> 設計書（`docs/design/`）の一部。目次・章とファイルの対応は [README.md](README.md)。章番号は設計書全体で共通。

## 16. 分担・実装の順番・完了の判定

### 16.1 担当

| 担当 | 設計書の範囲 | 主なファイル |
|---|---|---|
| A：AI / Backend / DB | 1.3〜1.4、1.8、2章、3章（追加の反映）、4章、5〜9章、11章（API）、12.1〜12.3・12.6、14.3 | `lib/server/*`、`lib/llm/*`、`supabase/*`、`app/api/**`、`proxy.ts`、`.env.example`、`AGENTS.md` |
| B：Planning Engine | 7.2（数値）、10章、12.4・12.5、13章、1.7（テスト環境） | `lib/planning/*`、`vitest.config.mts`、CI |
| C：Frontend | 14章 | `lib/api.ts`、`app/(main)/*`、`app/(onboarding)/*`、`lib/labels.ts` |

**A と B の境界**：入力は `PlanningContext`、出力は `EngineGenerateResult`・`EngineReplanResult`・`ValidationResult`。B は `fixtures.ts`（mocks/ から作る）で、DB なしで開発・テストする。A は B の関数をそのまま呼ぶだけで、配置・理由の文章に手を入れない。

### 16.2 順番

| 順 | A | B | C |
|---|---|---|---|
| 1 | migration の実行（4.1。SQL は `supabase/migrations/` に追加済み）、14.3 の `/api/clock`、パッケージ追加（3章のスキーマは追加済み） | vitest の設定、`fixtures.ts`、`skeleton`・`slots`（10.4・10.5）とテスト | 14.1、`/today`・`/calendar`・`/replan`・`/settings` の `fetchClock` 化（モックの `/api/clock` で確認） |
| 2 | `supabase.ts`・`auth.ts`・`clock.ts`・`http.ts`、ログイン・seed・リセット（5章・4.5）、`/api/clock` | `priority`（10.6）、`fit`・`allocate`・`day-beam`（P3〜P5）と単体テスト。**Day 1 のうちに fixture で1週間分を作り、月曜 18:00 以降に TOEIC があることと実行時間を確かめる** | 14.2 の残り |
| 3 | calendar・settings・tasks の本番化（11.3・9章）、`planning-context.ts` | `objectives`・`select`・`generate`（P6〜P11）、`validate`・`summarize`・`reasons`（10.11〜10.13・13章）、10.14 と P14のテスト | 結合確認：ログイン → `/today` |
| 4 | ヒアリング（`LLM_MODE=off` の台本 → `on` の LLM。6章）、3案（7章）、confirm（8章）、plans API（11.1） | `goal-candidates.ts`（7.2）とテスト | 結合確認：`/interview` → `/plans` → `/today` |
| 5 | replan・accept API（12.2・12.3・12.6） | `replan`・`diff`（12.4・12.5）と 12.7 のテスト | 結合確認：`/replan` |
| 6 | 全員：16.3 の通し確認（`LLM_MODE=on` と `off`）。バグ修正のみ | | |

LLM の実装が遅れても、`LLM_MODE=off` で Demo Path は通る。Planning Engine を先に仕上げることを優先する。

### 16.3 完了の判定（Demo Path）

`DEMO_MODE=1`、デモ用アカウント、リセット直後（デモ時刻 10/5 7:00）、Chrome のスマホ表示（390px）で、次を1回で通す。`LLM_MODE=on` と `off` の両方で行う。

- [ ] ① ログイン → ② ヒアリング（台本どおりに答える）→ ③ 目標時間3案が 9 / 6 / 3 時間
- [ ] ④ バランス標準型6時間で確定 → 自動ではスケジュールが作られない
- [ ] ⑤「スケジュール作成」→ 10秒以内に3案
- [ ] ⑥ 3案の比較表の数値が案ごとに違い、どの案も目標（TOEIC）が6時間
- [ ] ⑦ バランスプランを選ぶ → ⑧ `/today` に10/5の計画。タスクの詳細に理由がある
- [ ] ⑨「今日は疲れた」→ ⑩ 10秒以内に変更前後 → ⑪「この計画にする」で `/today` とカレンダーに反映
- [ ] `GET /api/mock/check` の errors が0件
- [ ] `npm run typecheck`・`npm run lint`・`npm test` が通る

各担当の作業の完了は、AGENTS.md の「作業の終わりに」と、各章の受け入れテストを満たすこと。
