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

### 3. PR作成

マージ先を **`main`** に指定してプルリクエストを作成する。