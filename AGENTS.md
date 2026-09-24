<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Personal AI Secretary プロジェクトルール

## 作業前に読むもの

- `docs/requirements.md`：要件定義書（資料間で食い違う場合はこれを優先）
- `docs/mock-spec.md`：モックの画面・データ・デモシナリオ
- `docs/codex_人割_タスク細分化_完成版_v2.md`：分担と進め方
- 関連する既存のファイル・型・API

仕様に書かれていないことは推測で作らず、質問すること。

## 守ること

- データの形は `lib/schemas.ts` の Zod スキーマが唯一の正。型は `z.infer` で作り、同じ形の型を別の場所に手書きしない。スキーマを変える場合は、変更内容と理由を報告してから行う
- フィールド名は snake_case、日時は `+09:00` 付きの ISO 8601、日付は `YYYY-MM-DD`
- APIのレスポンスは返す前にスキーマの `.parse()` を通す
- 対象はスマートフォン（基準幅390px）。タップ領域は44px以上
- shadcn/ui は **Base UI 版**。Radix 版の `asChild` ではなく `render` を使う。部品は `npx shadcn@latest add` で追加する
- 新しい npm パッケージは、追加する前に理由を報告する
- `src/` ディレクトリは使わない

## 責務

- LLM は自然言語の理解・情報抽出・説明だけを担当する。**最終的なスケジュールの時間配置は Planning Engine だけが行う**
- ヒアリング完了だけでスケジュールを生成しない。利用者が「スケジュール作成」を押したときだけ生成する
- 固定予定・睡眠・移動時間・締切・目標・完了済み・ロック済みの項目を勝手に変更しない
- 空き時間をすべてタスクで埋めない
- スケジュール3案の違いを説明文だけにしない

## モック段階の決まり

- LLM・Supabase は呼ばない。`mocks/` のデータを返す
- モックAPIのパスとレスポンスの形は本番と同じにする

## 作業の終わりに

1. `npm run typecheck`
2. `npm run lint`
3. 変更したファイル、実装内容、確認結果、未実装、残っているリスクを報告する