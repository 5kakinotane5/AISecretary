<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Personal AI Secretary プロジェクトルール

このファイルはすべてのブランチ・すべての作業に共通するルール。作業ごとの仕様は `docs/` の各資料に従う。

## 作業前に読むもの

- `docs/requirements.md`：要件定義書（資料間で食い違う場合はこれを優先）
- `docs/codex_人割_タスク細分化_完成版_v2.md`：分担と進め方
- `docs/design-spec.md`：見た目・言葉づかいの仕様（画面の見た目はこれを優先。）
- `docs/rule.md`：push・PR・コミットのルール（Gitの操作はこれに従う）
- 作業内容に対応する仕様書（例：モックの作業なら `docs/mock-spec.md`）
- 関連する既存のファイル・型・API

仕様に書かれていないことは推測で作らず、質問すること。既存実装と責務が重なるコードを新しく作らないこと。

## データとAPI

- データの形は `lib/schemas.ts` の Zod スキーマが唯一の正。型は `z.infer` で作り、同じ形の型を別の場所に手書きしない
- `lib/schemas.ts` は全員が依存する。変更する場合は、変更内容と理由を報告してから行う
- APIのJSON・スキーマ・DBの列名は snake_case。日時は `+09:00` 付きの ISO 8601、日付は `YYYY-MM-DD`
- 不明な値は `null` または空配列にする。推測で埋めない
- APIのレスポンスは、返す前にスキーマの `.parse()` を通す

## 画面

- 対象はスマートフォン縦画面（幅375〜430px、基準390px）。タップ領域は44px以上
- shadcn/ui は **Base UI 版**。Radix 版の `asChild` ではなく `render` を使う。部品は `npx shadcn@latest add <name>` で追加する
- アイコンは lucide-react
- `src/` ディレクトリは使わない

## 責務

- LLM は自然言語の理解・情報抽出・説明だけを担当する。**最終的なスケジュールの時間配置は Planning Engine だけが行う**
- ヒアリングが完了しただけでスケジュールを生成しない。利用者が「スケジュール作成」を押したときだけ生成する
- 利用者の確認なしに目標やスケジュールを確定しない
- 固定予定・睡眠・移動時間・締切・目標・完了済み・ロック済みの項目を勝手に変更しない
- 空き時間をすべてタスクで埋めない
- スケジュール3案の違いを説明文だけにしない

## モックとの関係

- モックの作業（`mocks/` とモックAPI）では、LLM・Supabase は呼ばず、`mocks/` のデータを返す
- モックAPIのパスとレスポンスの形は本番と同じにする。本物の処理に差し替えるときも、パスと形を変えない（変える場合は `lib/schemas.ts` と同じく事前に報告する）

## 環境・パッケージ

- Node.js は `.nvmrc`（24）、パッケージマネージャは npm。依存関係の再現には `npm ci` を使う
- 新しい npm パッケージは、追加する前に理由を報告する。追加したら `package.json` と `package-lock.json` を両方コミットする
- `.env.local` はコミットしない。APIキーをコードに直接書かない。`OPENAI_API_KEY` はサーバー側でだけ使う

## Git

- `main` では作業しない。今いるブランチが `main` なら、作業を始めずに報告する
- コミットはしてよいが、push と PR 作成は人間が行う
- コミットメッセージの先頭に種類を付ける：`feat:` 新機能 / `fix:` バグ修正 / `docs:` ドキュメント / `refactor:` 動作を変えない整理 / `chore:` 設定・環境など
- 1回のコミットには1つの目的の変更だけを入れる

## 作業の終わりに

1. `npm run typecheck`
2. `npm run lint`
3. 変更したファイル、実装内容、確認結果、未実装、残っているリスクを報告する