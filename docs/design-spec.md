# PURCHART デザイン仕様書

## 0. この文書について

モックと本番の画面の見た目を、デザインイメージ（`docs/design/purchart-concept.png`）に寄せるための仕様。

- 画面の構成・遷移・データは `docs/mock-spec.md` に従い、**見た目・言葉づかい・部品の形は本書を優先する**
- `docs/mock-spec.md` の 1.2（タブバー）と 1.3（予定の種類ごとの見た目）は、本書の 4章・5章で置き換える
- 色の値のうち「推定」と書いたものは、デザインイメージから読み取った近い値。見比べて調整してよい
- 実装の前に、必ずデザインイメージの画像を開いて確認すること

---

## 1. コンセプト

| 項目 | 内容 |
|---|---|
| アプリ名 | PURCHART（パーチャート） |
| タグライン | まだ決まっていない未来を、今の自分から航海する。 |
| 英語タグライン | Navigate your uncertain future. |
| 世界観 | 夜明け前の海を、羅針盤を頼りに進む航海。1日の予定は「航路」、計画全体は「航海図」 |
| トーン | 静か・やさしい・前向き。急かさない。詰め込まない |

**言葉づかいの原則**：予定変更を失敗として扱わない（要件定義書 6.12.5）。「遅れ」「未達成」ではなく「航路を調整」「余白」と表現する。

---

## 2. デザイントークン

`app/globals.css` の CSS 変数として定義し、shadcn/ui の変数（`--primary` など）もこの値に合わせる。Tailwind からは `bg-primary` のように変数経由で使い、色コードを直接書かない。

### 2.0 配色の基本方針：紫基調

**すべての画面を紫基調にする。** どの画面を開いても、一目で PURCHART だと分かる色づかいにする。

| 役割 | 色 | 画面に占める割合の目安 |
|---|---|---|
| ベース | `--brand-bg`・白（カード） | 約60% |
| メイン | 紫系（`--brand-purple`〜`--brand-purple-pale`、紫のグラデーション） | 約30% |
| アクセント | 予定の種類ごとの色（オレンジ・ピンク・緑など） | 約10%以下 |

- **各画面に、紫の面を必ず1つ以上置く**：ヘッダー（2.2 のグラデーション）、主ボタン、選択中のタブ、ユーザーの吹き出しなど
- **灰色は紫寄りにする**：素の灰色（`slate`・`gray`・`zinc` など）は使わず、2.1 の「紫寄りの灰色」を使う。境界線・補足の文字・無効状態も同じ
- **紫以外の色は小さく使う**：2.3 の予定の種類ごとの色は、丸印・細い線・薄い背景だけに使い、画面の大きな面（ヘッダー・ボタン・全面の背景）には使わない
- **青・緑を主役にしない**：リンク、選択状態、フォーカスの枠、トグル、進行状況バーなど、ブラウザや部品の既定色が青になりがちな所も、すべて紫にそろえる
- **エラーだけは例外**：エラーの文字と枠は赤系（`#E5484D`、推定）を使ってよい。ただし面積は小さく

### 2.1 基本色（デザインイメージのカラーパレット）

| 変数名 | 値 | 用途 |
|---|---|---|
| `--brand-purple` | `#7B61FF` | メイン。主ボタン、選択中のタブ、タスク |
| `--brand-purple-light` | `#A78BFA` | サブ。アイコン、グラデーションの中間 |
| `--brand-purple-pale` | `#E9D8FF` | 背景の差し色、ユーザーの吹き出し、選択中のチップ |
| `--brand-dark` | `#0F172A` | 文字の基本色、暗い背景（ヘッダー・スプラッシュ） |
| `--brand-bg` | `#F8FAFC` | 画面の背景 |
| `--surface` | `#FFFFFF` | カード |
| `--purple-gray` | `#8B85AD`（推定） | 紫寄りの灰色。補足の文字、選択されていないタブ、アイコン |
| `--purple-gray-light` | `#DCD8EE`（推定） | 紫寄りの薄い灰色。境界線、区切り線、無効状態 |

shadcn/ui との対応：`--primary` = `--brand-purple`、`--primary-foreground` = 白、`--background` = `--brand-bg`、`--foreground` = `--brand-dark`、`--card` = `--surface`、`--muted` = `#F1F0FB`（推定）、`--muted-foreground` = `--purple-gray`、`--border` = `--purple-gray-light`、`--input` = `--purple-gray-light`、`--ring` = `--brand-purple-light`

`--chart-*`・`--sidebar-*`（グラフ・サイドバー用にshadcn/uiが持つ変数。青・緑の既定色を残さないための対応）：

- `--chart-1`〜`--chart-5` は順に `--brand-purple`・`--brand-purple-light`・`--brand-purple-pale`・`--purple-gray`・`--kind-free`
- `--sidebar` = `--background`、`--sidebar-foreground` = `--foreground`、`--sidebar-primary` = `--primary`、`--sidebar-primary-foreground` = `--primary-foreground`、`--sidebar-accent` = `--accent`、`--sidebar-accent-foreground` = `--accent-foreground`、`--sidebar-border` = `--border`、`--sidebar-ring` = `--ring`

### 2.2 グラデーション（推定）

| 変数名 | 値 | 用途 |
|---|---|---|
| `--gradient-night` | `linear-gradient(180deg, #0F172A 0%, #2E2170 45%, #5B45C9 75%, #C9A7F5 100%)` | スプラッシュ（ログイン）画面の背景。夜空→夜明けの水平線 |
| `--gradient-header` | `linear-gradient(160deg, #2E2170 0%, #5B45C9 60%, #7B61FF 100%)` | ホームの上部ヘッダー |
| `--gradient-deep` | `linear-gradient(180deg, #1E1B4B 0%, #312E81 100%)` | 航海図・AIとの対話のヘッダー |

### 2.3 予定の種類ごとの色（推定）

デザインイメージの「今日の航路」の丸印の色から決める。

| kind / category | 丸印の色 | ブロック背景 | 補足 |
|---|---|---|---|
| `task` | `#7B61FF` | `#F3EFFF` | 主役。左に紫の線 |
| `fixed`（class / work / other） | `#F59E6B` | `#FFF4EC` | オレンジ系（イメージの「ミーティング」） |
| `fixed`（meal） | `#F7A38B` | `#FFF1EC` | イメージの「昼休み」 |
| `fixed`（social / family） | `#F472B6` | `#FDF0F7` | 大切な人との時間。ハートのアイコン |
| `travel` | `--purple-gray` | 透明＋破線の枠 | 船の航跡のような細い点線で前後をつなぐ |
| `buffer` | `#A78BFA` | `#F6F2FF`＋破線の枠 | 「余白」と表示 |
| `free` | `#5EC4A8` | `#EDF9F5` | イメージの「散歩」。「自由時間」 |
| `sleep` | `#4B4577` | 1行に折りたたみ | |

**色の値は `app/globals.css` だけに書く。** `lib/labels.ts` を含むコード側は、色の値を直接持たず、下のCSS変数名だけを参照する（`style={{ backgroundColor: "var(--kind-task)" }}` のように使う）。9.6参照。

| kind / category | 丸印の変数名 | ブロック背景の変数名 |
|---|---|---|
| `task` | `--kind-task` | `--kind-task-bg` |
| `fixed`（class / work / other） | `--kind-fixed` | `--kind-fixed-bg` |
| `fixed`（meal） | `--kind-meal` | `--kind-meal-bg` |
| `fixed`（social / family） | `--kind-social` | `--kind-social-bg` |
| `travel` | `--kind-travel` | （透明のため変数なし） |
| `buffer` | `--kind-buffer` | `--kind-buffer-bg` |
| `free` | `--kind-free` | `--kind-free-bg` |
| `sleep` | `--kind-sleep` | （1行折りたたみのため変数なし） |

締切バッジ（5.4・9.3参照）の色は `--deadline-bg`・`--deadline-fg`。

### 2.4 形・影・余白

| 項目 | 値 |
|---|---|
| カードの角丸 | 24px（`rounded-3xl`） |
| ボタンの角丸 | 完全な丸（`rounded-full`） |
| 入力欄の角丸 | 完全な丸（`rounded-full`） |
| チップ・小さなタグの角丸 | 12px |
| カードの影 | `0 8px 24px rgba(91, 69, 201, 0.10)`（紫がかった柔らかい影） |
| 画面の左右余白 | 16px |
| カード内の余白 | 16〜20px |
| 主ボタンの高さ | 52px |

---

## 3. 文字

| 用途 | フォント | 太さ・サイズ |
|---|---|---|
| 本文（日本語） | Noto Sans JP | 400、16px |
| 本文（英数字） | Inter | 400 |
| 見出し | Noto Sans JP | 700、20〜24px |
| 時刻 | Inter | 500、等幅数字（`tabular-nums`） |
| ロゴ | 幾何学的な太いサンセリフ（Outfit または Montserrat の 700 を推奨。推定） | 字間を少し広げる |

- フォントは `next/font/google` で読み込む（npm パッケージの追加は不要）
- `app/layout.tsx` で Inter と Noto Sans JP を CSS 変数として設定し、`font-sans` から使う

---

## 4. 言葉づかい（画面上の表示名）

内部の名前（スキーマ・API・ファイル名）は変えない。**画面に出す文言だけ**を置き換える。定義は `lib/labels.ts` に集める。

| 内部の概念 | 画面の表示 |
|---|---|
| 今日の予定（`/today`） | 今日の航路 |
| スケジュール3案 | 航路プラン（集中の航路／バランスの航路／ゆとりの航路） |
| カレンダー（`/calendar`） | 航海図 |
| 再計画（`/replan`） | AIとの対話 ／ ボタンは「航路を調整する」 |
| バッファ | 余白 |
| 現在時刻の線 | 現在地 |
| 目標（Goal） | 目的地 |
| ヒアリング（`/interview`） | 航海の準備（目的地を決める） |

挨拶の例：「おはよう、今日もよい航路を。」（5〜11時）、「こんにちは、今日の航路は順調ですか。」（11〜17時）、「おつかれさま、今日の航路をふり返ろう。」（17時〜）

---

## 5. 共通部品

### 5.1 スマホの枠（PC表示）

`docs/mock-spec.md` 10章の決定事項のとおり。枠の外の背景は `--brand-bg` に、ごく薄い紫のぼかし（`radial-gradient`）を重ねる。

### 5.2 タブバー（`mock-spec.md` 1.2 を置き換え）

白背景、上に細い境界線。選択中はアイコンと文字が `--brand-purple`、それ以外は `--purple-gray`。

| タブ | アイコン（lucide-react） | 遷移先 |
|---|---|---|
| ホーム | `House` | `/today` |
| 航海図 | `Map` | `/calendar` |
| AIと対話 | `MessageCircle` | `/replan` |
| 設定 | `Settings` | `/settings` |

デザインイメージのタブ「記録」は、週間・月間レビュー（優先度B）なのでモックでは作らない。

### 5.3 ボタン

| 種類 | 見た目 |
|---|---|
| 主ボタン | `--brand-purple` の塗り、白文字、`rounded-full`、高さ52px、横幅いっぱい。例：「航路を調整する」「スケジュール作成」 |
| 副ボタン | 白の塗り、紫の文字と枠線 |
| テキストボタン | 紫の文字だけ |

### 5.4 タイムライン（今日の航路）

デザインイメージのホーム画面の「今日の航路」カードを基準にする。

- 白いカード（角丸24px）の中に、縦の細い線でつながった丸印を並べる
- 各行：左に時刻（Inter、`tabular-nums`）、中央に丸印、右にタイトル（太字）と補足（小さい灰色の文字。場所や締切バッジなど）
- 丸印は直径24px。2.3の色で塗り、中に白い14pxのアイコンを置く（アイコンは`mock-spec.md` 1.3を引き継ぐ。下の対応表のとおり）
- 現在時刻の行は、時刻を `--brand-purple-pale` の角丸の枠で囲む（イメージの「9:00」）
- 移動は丸印ではなく、前後の丸をつなぐ線を点線にして「移動 50分」と小さく表示
- 余白（バッファ）は丸印を破線の輪にする。中のアイコンは紫（`--brand-purple`）にする（塗りがないため）
- 締切バッジ「締切 10/9」：背景 `--brand-purple-pale`、文字色 `#5B45C9`、左に `Flag` アイコン（16px）。**赤は使わない**（9.3参照）
- `mock-spec.md` の「高さを所要時間に比例」は採用せず、**1項目1行のリスト**にする（イメージに合わせる）。週表示の航海図だけ比例表示を使う

**丸印のアイコン対応表**（`mock-spec.md` 1.3を引き継ぐ。9.3参照）

| kind / category | アイコン（lucide-react） | 丸印の見た目 |
|---|---|---|
| `fixed`（class / work / other） | `School` / `Briefcase` | 2.3の色で塗り、白いアイコン |
| `fixed`（meal） | `Utensils` | 同上 |
| `fixed`（social / family） | `Heart` | 同上 |
| `travel` | `TrainFront` / `Footprints` | 丸印は置かず、点線のみ（本文のとおり） |
| `task` | `CircleCheck` | 2.3の色で塗り、白いアイコン |
| `buffer` | `Hourglass` | 破線の輪、紫（`--brand-purple`）のアイコン |
| `free` | `Coffee` | 2.3の色で塗り、白いアイコン |
| `sleep` | `Moon` | 1行に折りたたみ（丸印は置かない） |

### 5.5 チャットの吹き出し（AIとの対話・航海の準備）

- ユーザー：右寄せ、`--brand-purple-pale` の背景、角丸20px（右下だけ小さく）
- AI：左寄せ、白の背景、左にコンパスのアイコン（紫の丸の中に `Compass`）
- 入力欄：白、`rounded-full`、placeholder「何でも話してみてください…」、右に紫の丸い送信ボタン（`ArrowUp` アイコン）

### 5.6 おすすめ・候補カード

デザインイメージの「今日のおすすめ航路」を基準にする。白いカードに、左にパステル色の丸いアイコン、右にタイトル（太字）と補足。目標時間3案（`/interview`）、再計画の変更点（`/replan`）、航路プランの比較（`/plans`）に使う。

### 5.7 コンパスのマーク

- ロゴとアプリアイコンの中心にある「円＋4方向に伸びる星」を、SVG で `components/brand/CompassMark.tsx` として作る
- 星は白〜`--brand-purple-pale` のグラデーション、周りの円は細い線
- ロゴ「PURCHART」は、テキスト「PUR」＋コンパスのマーク入りの「C」＋「HART」で組む（`components/brand/Logo.tsx`）。完全に再現できなければ、テキストのロゴ＋横に CompassMark でよい

---

## 6. 画面ごとの見た目

| 画面 | デザインイメージの対応 | 見た目のポイント |
|---|---|---|
| `/login` | 1枚目（スプラッシュ） | 背景 `--gradient-night`、中央に大きな CompassMark とロゴ、タグライン（日本語・英語）。下部に白の主ボタン「はじめる」。下端に水平線と海の光（CSS のグラデーションで表現。画像がある場合は `public/brand/` の画像を使う） |
| `/interview` | 4枚目（AIとの対話） | ヘッダー `--gradient-deep`「航海の準備」。5.5の吹き出し、目標時間3案は5.6のカードを縦に3枚 |
| `/plans` | 2枚目の応用 | ヘッダー `--gradient-header`「航路プランを選ぶ」。比較表は白いカード。3案の切り替えは `--brand-purple-pale` の角丸のセグメント |
| `/today` | 2枚目（ホーム） | 上部 `--gradient-header` に挨拶と日付。その下に白いカード「今日の航路」（5.4）が上部に少し重なる。下部に主ボタン「航路を調整する」 |
| `/replan` | 4枚目（AIとの対話） | ヘッダー `--gradient-deep`「AIとの対話」。変更点は「今日のおすすめ航路」風のカードで表示 |
| `/calendar` | 3枚目（あなたの航海図） | ヘッダー `--gradient-deep`「あなたの航海図」。月／週／日（初期表示は週）の切り替えは、イメージの「週／月／長期」セグメントと**同じ形（角丸のピル型）だけ**を真似る。選択肢は月／週／日のままとし、「長期」は作らない（9.2参照）。下部に「今週のコンディション」風の白いカード（タスク時間・余白・自由時間の合計を細い線のグラフで） |
| `/settings` | 2枚目のカードの形 | 白いカードに項目を並べる |

---

## 7. 画像素材

デザインイメージの絵（夜明けの海の風景、島の地図のイラスト）はコードでは再現できない。

- 使う場合は、画像から切り出して `public/brand/` に置く（例：`app-icon.png`、`splash-sea.png`）
- **画像がない場合でも画面が成り立つ**ように、CSS のグラデーションと CompassMark だけの表現を基本にする
- 航海図の島のイラストはモックでは作らない（月／週／日の表示を優先）

---

## 8. やらないこと

- デザインイメージのピクセル単位の再現
- イラストの自作（地図・風景）
- 「記録」タブ（週間・月間レビュー）
- ダークモード

---

## 9. 決定事項

実装前に確認した不明点への回答をまとめる。画面構成・APIに関わる決定は `docs/mock-spec.md` 10章にもある。

### 9.1 デザインイメージなしで進める

`docs/design/purchart-concept.png` は用意されていないため、画像なしで進める。本書に書かれている色コード・グラデーション値・形の数値（「推定」と書かれたものも含む）を正として実装してよい。

ただし、あとから画像を差し込みやすいように、7章の方針（画像がなくても画面が成り立つよう、CSSグラデーションとCompassMarkだけで表現する。画像を使う場合の置き場所は `public/brand/` に固定）はそのまま守ること。画像が用意でき次第、この構成を崩さずに差し替えられるようにする。

### 9.2 `/calendar` のセグメントは見た目だけ真似る

6章の「イメージの『週／月／長期』と同じ形のセグメント」は、**角丸のピル型という見た目（部品の形）だけ**を真似る指示であり、選択肢の中身は変えない。`/calendar` の選択肢は `mock-spec.md` 2.6のとおり「月／週／日」のままとし、初期表示は週。「長期」という選択肢は作らない。6章の記述を修正済み。

### 9.3 タイムラインの丸印・アイコン・締切バッジ

5.4章に反映済み。

- 丸印は直径24px、2.3の色で塗り、中に白い14pxのアイコンを置く。アイコンは `mock-spec.md` 1.3のもの（`School`／`Briefcase`／`Utensils`／`Heart`／`TrainFront`／`CircleCheck`／`Hourglass`／`Coffee`／`Moon`）を引き継ぐ
- 余白（buffer）は破線の輪。中のアイコンは紫（`--brand-purple`）
- 締切バッジ「締切 10/9」は赤を使わない：背景 `--brand-purple-pale`、文字色 `#5B45C9`、左に `Flag` アイコン。`mock-spec.md` 1.3の「赤いバッジ」の記述は削除し、本書を参照するように修正済み

### 9.4 デモ時刻の表示

- ヘッダーの右上に、半透明の白い角丸のチップ（例：「デモ 07:00」）で表示する
- `/replan` の「デモのため、時刻を18:00に進めました」は、ヘッダーの下に小さな文字で表示する
- 表示するかどうか自体（データ・機能面）は `mock-spec.md` 2.4・2.5のとおりで変更なし。本項は見た目の置き場所の決定

### 9.5 アプリ名「PURCHART」の適用範囲

PURCHARTにする範囲：

- 画面上の表示（`lib/labels.ts`）
- `app/layout.tsx` の `metadata`（`title`は「PURCHART」、`description`はタグライン「まだ決まっていない未来を、今の自分から航海する。」）
- `README.md` の見出し（「PURCHART（Personal AI Secretary）」）

変えない範囲：`package.json` の `name`、リポジトリ名、ディレクトリ名、コード内の変数名・ファイル名、`AGENTS.md` の見出し。

### 9.6 予定の種類ごとの色はCSS変数で管理する

- 色の値（`#7B61FF` など）は `app/globals.css` だけに書く。`lib/labels.ts` を含むコード側は変数名だけを持ち、`style={{ backgroundColor: "var(--kind-task)" }}` のように参照する
- 変数名は次のとおり（値は `app/globals.css` に定義する。2.3参照）
  - 丸印の色：`--kind-task`、`--kind-fixed`、`--kind-meal`、`--kind-social`、`--kind-travel`、`--kind-buffer`、`--kind-free`、`--kind-sleep`
  - ブロック背景：上の名前に `-bg` を付ける（例：`--kind-task-bg`）
  - 締切バッジ：`--deadline-bg`、`--deadline-fg`
- 2.3章に反映済み

### 9.7 アイコンの確定

- 固定予定の `other` は `CalendarClock`（`School`／`Briefcase`と紛らわしいため区別する）
- 移動のアイコンは移動手段（`TravelMode`）で決める：`train`・`walk_train` → `TrainFront` ／ `walk` → `Footprints` ／ `bus` → `Bus` ／ `bike` → `Bike`
- 5.4章・9.3章の「TrainFront / Footprints」の記述を上記のとおり確定する

`app/layout.tsx`・`README.md` 自体の編集は、モック実装の作業の中で行う（本項は方針の記録のみ）。