# Personal AI Secretary

技育CAMPハッカソン用のリポジトリです。

---

## 技術スタック

| 役割                 | 使うもの                  | バージョンの決め方              |
| -------------------- | ------------------------- | ------------------------------- |
| 実行環境             | Node.js 24（LTS）         | `.nvmrc` で固定                 |
| バージョン管理ツール | fnm                       | `.nvmrc` を読んで自動で切り替え |
| パッケージマネージャ | npm                       | `package-lock.json` で固定      |
| フレームワーク       | Next.js（App Router）     | 同上                            |
| 言語                 | TypeScript                | 同上                            |
| データ検証           | Zod                       | 同上                            |
| 見た目               | Tailwind CSS ＋ shadcn/ui | 同上                            |
| DB・認証             | Supabase（クラウド）      | Day 1以降に使用                 |
| LLM                  | OpenAI API                | Day 1以降に使用                 |

**Dockerは使いません。** 手元に必要なのはNode.jsだけで、DBはクラウドのSupabaseを使うためです。

---

## 1. 事前にインストールするもの

以下が入っていなければインストールしてください。

| ツール  | 入手先                         |
| ------- | ------------------------------ |
| Git     | https://git-scm.com/           |
| VS Code | https://code.visualstudio.com/ |
| fnm     | 下の手順                       |

> **Node.jsを公式サイトから直接インストールしないでください。** バージョンがずれる原因になります。Node.jsはfnm経由で入れます。すでに入っている人も、このあとの手順でfnmのNodeが優先されるので、そのままで大丈夫です。

### fnmのインストール

**Windows（PowerShell）**

Windowsは手順が少し多いので、**①〜④を順番どおりに**進めてください。

**① fnmをインストールする**

```powershell
winget install Schniz.fnm
```

インストールが終わったら、**PowerShellを一度閉じて開き直してください。**（開き直さないと `fnm` コマンドが見つかりません）

**② スクリプトの実行を許可する（1回だけ）**

Windowsは初期設定でPowerShellのスクリプト（`.ps1` ファイル）の実行をすべて禁止しているため、このままだと次の③で作る設定ファイルが読み込まれません。次を実行して許可します。

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

確認メッセージが出たら `Y` を入力してEnterを押します。何も表示されずに終われば成功です。
（`CurrentUser` なので変更されるのは自分のユーザーだけで、管理者権限は不要です）

**③ 設定ファイルに1行追加する**

```powershell
if (!(Test-Path $PROFILE)) { New-Item -Path $PROFILE -Force }
notepad $PROFILE
```

メモ帳が開くので、次の1行を貼り付けて `Ctrl + S` で保存し、メモ帳を閉じます。

```powershell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
```

> 設定ファイルの場所は `echo $PROFILE` で確認できます。`C:\Users\<ユーザー名>\OneDrive\ドキュメント\WindowsPowerShell\...` のようにOneDrive配下になっていることがありますが、そのままで問題ありません。

**④ 設定を読み込む**

保存できたか確認します。

```powershell
Get-Content $PROFILE
```

③で貼り付けた1行が表示されればOKです。続けて、設定を今のターミナルに読み込みます（先頭の `.` とスペースも必要です）。

```powershell
. $PROFILE
```

何も表示されずに終われば成功です。次回からは、新しくターミナルを開くだけで自動的に読み込まれます。

> 「デジタル署名されていない」という赤いエラーが出た場合は、次を実行してからもう一度 `. $PROFILE` を実行してください。
>
> ```powershell
> Unblock-File $PROFILE
> ```

**Mac（ターミナル）**

```bash
brew install fnm
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc
```

ターミナルを閉じて開き直してください。

### 確認

```bash
fnm --version
```

バージョン番号が表示されればOKです。

---

## 2. リポジトリを取得する

```bash
git clone https://github.com/5kakinotane5/AISecretary.git
cd AISecretary
```

---

## 3. Node.jsを入れる

リポジトリのフォルダの中で実行します。

```bash
fnm install
fnm use
node -v
```

`v24.x.x` と表示されればOKです。
`--use-on-cd` を設定しているので、次回からはこのフォルダに `cd` するだけで自動的にNode 24に切り替わります。

---

## 4. パッケージを入れる

```bash
npm ci
```

> `npm install` ではなく **`npm ci`** を使ってください。`npm ci` は `package-lock.json` に書かれたバージョンを完全にそのまま入れるので、3人の環境が一致します。

---

## 5. 環境変数ファイルを作る

**Windows**

```powershell
copy .env.example .env.local
```

**Mac**

```bash
cp .env.example .env.local
```

モックの段階では中身は空のままで大丈夫です。Supabase・OpenAIのキーはDay 1の前に共有します。

> `.env.local` には秘密のキーが入るので、**絶対にGitにコミットしないでください。**（`.gitignore` で除外済みです）

---

## 6. VS Codeの拡張機能を入れる

VS Codeでリポジトリのフォルダを開くと、右下に「おすすめの拡張機能をインストールしますか？」と表示されるので、**すべてインストール**してください。

表示されなかった場合は、拡張機能タブで次の3つを検索して入れてください。

| 拡張機能                  | 役割                                 |
| ------------------------- | ------------------------------------ |
| ESLint                    | コードの問題点を指摘する             |
| Prettier - Code formatter | 保存時にコードの見た目を自動で整える |
| Tailwind CSS IntelliSense | Tailwindのクラス名を補完する         |

保存するたびに自動でフォーマットされる設定は `.vscode/settings.json` に入っているので、自分で設定する必要はありません。

---

## 7. 動作確認

次の3つがすべて通れば、環境構築は完了です。

```bash
npm run dev
```

ブラウザで http://localhost:3000 を開いて画面が表示されればOK。確認したら `Ctrl + C` で止めます。

```bash
npm run typecheck
npm run lint
```

どちらもエラーが出なければOKです。

**ここまで終わったら、チームのチャットに「環境構築完了」と報告してください。**

---

## 開発の進め方

### ブランチ

`main` への直接pushは禁止です。必ずブランチを切ってPRを出します。

| 担当                 | ブランチ                  |
| -------------------- | ------------------------- |
| A：AI / Backend / DB | `feature/interview-ai`    |
| B：Planning Engine   | `feature/planning-engine` |
| C：Frontend / UX     | `feature/frontend`        |
| 統合用               | `integration/mvp`         |

```bash
git switch main
git pull
git switch -c feature/xxxx
```

### PRを出す前に必ず実行するもの

```bash
npm run typecheck
npm run lint
```

PRを出すとGitHub Actionsでも同じチェックが自動で走ります。赤い×が付いたらマージせずに直してください。

### 他の人の変更を取り込んだあと

`git pull` のあとに `package-lock.json` が変わっていたら、必ず次を実行してください。

```bash
npm ci
```

パッケージを新しく追加するときは `npm install パッケージ名` を使い、変更された `package.json` と `package-lock.json` を**両方**コミットしてください。

---

## ディレクトリ構成（予定）

```
AISecretary/
├── app/                 # 画面とAPI（Next.js App Router）
│   ├── api/             # /api/... のAPI（モック段階では固定JSONを返す）
│   └── ...              # 各画面
├── components/          # 画面の部品
├── lib/
│   └── schemas.ts       # Zodスキーマ＝3人の間のデータの約束（共同で管理）
├── mocks/               # モック用のダミーデータ
└── docs/                # 要件定義書・タスク細分化・プロンプト集
```

`lib/schemas.ts` はA・B・C全員が依存するファイルです。**変更するときは必ずチームに一声かけてから**にしてください。

---

## 困ったとき

| 症状                                                                    | 対処                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `fnm` が見つからないと言われる                                          | `winget install` のあとにターミナル（PowerShell）を開き直したか確認                               |
| `fnm use` で「We can't find the necessary environment variables」と出る | 設定ファイルが読み込まれていない。`Get-Content $PROFILE` で1行があるか確認し、`. $PROFILE` を実行 |
| 「このシステムではスクリプトの実行が無効になっている」と出る            | 手順1-②の `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` を実行してから `. $PROFILE`       |
| 「デジタル署名されていない」と出る                                      | `Unblock-File $PROFILE` を実行してから `. $PROFILE`                                               |
| VS Codeのターミナルだけfnmが効かない                                    | ターミナル右上のゴミ箱アイコンで削除して開き直す（それでもダメならVS Codeを再起動）               |
| `node -v` が24以外になる                                                | リポジトリのフォルダの中で `fnm use` を実行                                                       |
| `npm ci` が失敗する                                                     | `node -v` が24か確認してから、`node_modules` フォルダを削除して再実行                             |
| `npm run dev` で「ポート3000が使用中」と出る                            | 他のターミナルで動いている `npm run dev` を `Ctrl + C` で止める                                   |
| 何も変えていないのに全行が差分になる                                    | 改行コードの問題。`.gitattributes` があるか確認してチームに相談                                   |
| それでも解決しない                                                      | エラーメッセージをそのままコピーしてチームに共有                                                  |

---

## 付録：初期構築の記録（リポジトリ管理者が1回だけ実施）

他の2人は実施不要です。何をしたかの記録として残しています。

1. `npx create-next-app@latest . --ts --tailwind --eslint --app` でプロジェクト作成
2. `npx shadcn@latest init` で shadcn/ui を導入
3. `npm install zod` と `npm install -D prettier` を実行
4. `package.json` に次を追加
   ```json
   "engines": { "node": ">=24 <25" },
   "scripts": {
     "typecheck": "tsc --noEmit",
     "format": "prettier --write ."
   }
   ```
5. `.nvmrc` / `.gitattributes` / `.prettierrc` / `.env.example` / `.vscode/` / `.github/workflows/ci.yml` を追加
6. `docs/` に要件定義書・タスク細分化・プロンプト集を配置
