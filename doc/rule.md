# 開発・ブランチルール

## ブランチの役割
* **`main`**: 本番・開発の共通土台。直接コミット・直接プッシュは一律禁止。
* **`feature/機能名`**: 作業用。必ず `main` から分岐して作成する。

## 禁止事項
`main`ブランチにpush

## 開発からマージまでの手順

### 1. Issueの作成
Issueを作成して、紐づけたブランチをリモートに作成する。

### 2. ブランチ作成
ローカルの `main` を最新にしてから、機能ブランチを切る。
```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name

```

### 3. コミット・Push

バックアップのため、**最低1日に1回以上**プッシュする。

```bash
git add .
git commit -m "作業内容"
git push origin feature/your-feature-name



```
## コミットメッセージのルール

コミットメッセージの先頭に、変更の種類を表す接頭辞を付ける。

| 接頭辞 | 意味 | 例 |
|---|---|---|
| `feat:` | 新機能 | `feat: 予定入力画面を追加` |
| `fix:` | バグ修正 | `fix: 日付がずれる不具合を修正` |
| `docs:` | ドキュメント | `docs: ルールファイルを追加` |
| `refactor:` | 動作を変えないコードの整理 | `refactor: API呼び出しを関数に分離` |

### 3. PR作成

マージ先を **`main`** に指定してプルリクエストを作成する。