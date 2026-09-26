# Supabase 導入手順（パーソナルAI秘書）

> 設計書 `backend.md`（4〜5章）・`common.md`（1〜2章）に合わせた、実際に作業する順番の手順書。
> 章番号（例：4.5）は設計書の章を指す。

## 目次

0. [全体像](#0-全体像)
1. [Supabase プロジェクトを作る](#1-supabase-プロジェクトを作る)
2. [キーを取得する](#2-キーを取得する)
3. [環境変数を設定する](#3-環境変数を設定する)
4. [表・RLS・関数を作る（SQL Editor）](#4-表rls関数を作るsql-editor)
5. [パッケージを入れる](#5-パッケージを入れる)
6. [Supabase クライアントを作る](#6-supabase-クライアントを作る)
7. [認証：requireUser と proxy.ts](#7-認証requireuser-と-proxyts)
8. [ログイン API（mock-login）と seed](#8-ログイン-apimock-loginと-seed)
9. [読み書き（repositories/）](#9-読み書きrepositories)
10. [トランザクション（rpc）](#10-トランザクションrpc)
11. [動作確認](#11-動作確認)
12. [よくあるハマりどころ](#12-よくあるハマりどころ)

---

## 0. 全体像

Supabase は「PostgreSQL＋認証＋API」をまとめたサービス。このプロジェクトで使うのは次の3つ。

| 機能 | 役割 | 設計書 |
|---|---|---|
| Database（PostgreSQL） | 13個の表を置く | 4.2 |
| Auth | デモ用アカウントのログインとセッション | 5章 |
| RLS（行レベルセキュリティ） | 「自分の行しか読めない・書けない」を DB 側で強制する | 4.3 |

```text
ブラウザ ──Cookie──▶ Next.js Route Handler ──(利用者のセッション付き)──▶ Supabase
                       requireUser()                  RLS で user_id = auth.uid() の行だけに絞られる
```

- サーバー側のコードは**利用者本人として** DB にアクセスする。そのため RLS が効き、`user_id` を手で渡す必要がない
- リクエストから `user_id` を受け取らない。`requireUser()` の戻り値だけを使う（2.1）
- サービスロール（Secret key）は**デモ用アカウントの作成だけ**に使う（2.1）

---

## 1. Supabase プロジェクトを作る

※ 1人が作り、チームで同じプロジェクトを使う。

1. https://supabase.com でサインアップし、**New project** を押す
2. Region は **Northeast Asia (Tokyo)** を選ぶ
3. DB パスワードを決める（今回のコードでは使わないが、控えておく）
4. ダッシュボードのトップで Status が **Healthy** になるまで待つ

---

## 2. キーを取得する

| 値 | 形 | 場所 | 公開してよいか |
|---|---|---|---|
| Project URL | `https://xxxx.supabase.co` | トップ画面の URL 横の **Copy** | ○ |
| Publishable key（旧 anon key） | `sb_publishable_...` | トップ画面の **Copy** メニュー | ○（RLS が守る） |
| Secret key（旧 service_role） | `sb_secret_...` | 下記 | **×** |

**Secret key の場所**（トップ画面の Copy メニューには出てこない）

1. 左サイドバー最下部の**歯車アイコン（Project Settings）**
2. **API Keys**
3. **Secret keys** の欄で、目のアイコン（Reveal）を押すかコピーする
   - 欄が空なら「Add new secret key」で作る
   - 「Legacy API keys」タブの `service_role` も同じ役割なので、そちらを使ってもよい

> **Secret key は RLS を無視して全データを読み書きできる鍵。**
> チャット・GitHub・スクリーンショットに載せない。漏れたら同じ画面で削除して作り直す（削除した鍵はすぐ使えなくなる）。

---

## 3. 環境変数を設定する

### 3.1 `.env.local`（自分の PC だけ。GitHub に上げない）

```bash
cp .env.example .env.local   # ひな形をコピーして、値を埋める
```

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=sb_secret_xxx        # NEXT_PUBLIC_ を付けない！
DEMO_MODE=1
DEMO_USER_EMAIL=demo@example.com
DEMO_USER_PASSWORD=長めのパスワード
LLM_MODE=off
OPENAI_API_KEY=
OPENAI_MODEL=
```

### 3.2 `NEXT_PUBLIC_` とは

Next.js のルールで、**「ブラウザに送ってよい」という目印**。

| 変数名 | 読める場所 | 使う値 |
|---|---|---|
| `NEXT_PUBLIC_` あり | サーバー＋**ブラウザ**（ビルド時に JS へ文字列として埋め込まれ、誰でも見られる） | URL・Publishable key |
| `NEXT_PUBLIC_` なし | サーバー（Route Handler・proxy）だけ | Secret key・OpenAI のキー・デモ用パスワード |

Secret key に `NEXT_PUBLIC_` を付けると、サイトを開いた人全員に鍵を配ることになる。

### 3.3 `.env.example` と `.env.local` の違い

| | `.env.example` | `.env.local` |
|---|---|---|
| 中身 | 変数の**名前だけ**（値は空） | **本物の値** |
| GitHub | 上げる | 上げない（`.gitignore` で除外） |
| 目的 | 必要な変数をチームに伝える | 自分の環境で動かす |

**確認すること**

- [ ] `.gitignore` に `.env*.local`（または `.env.local`）が入っている
- [ ] `git status` に `.env.local` が**出てこない**
- [ ] `.env.example` に本物の値が入っていない（入れて push していたら、その鍵を作り直す）
- [ ] 値の共有は GitHub ではなく DM など外に残らない方法で行う
- [ ] Vercel の **Settings → Environment Variables** にも同じ値を登録する

---

## 4. 表・RLS・関数を作る（SQL Editor）

設計書 4.1 のとおり、**Supabase CLI は使わず**ダッシュボードで実行する。

1. 左メニューの **SQL Editor → New query**
2. `supabase/migrations/0001_init.sql` の中身を貼って **Run**
3. 同じように `0002_functions.sql` を **Run**
4. **Table Editor** で次を確かめる
   - [ ] 13個の表がある
   - [ ] すべての表に鍵のマーク（RLS 有効）が付いている

**ルール**

- 各ファイルは番号順に**1回だけ**実行する
- 変更するときは既存ファイルを直さず、`0003_xxx.sql` のように新しい番号のファイルを足す
- 実行したことを PR の説明に書く

### 4.1 RLS の仕組み（`0001_init.sql` の最後）

```sql
alter table tasks enable row level security;

create policy "own rows" on tasks
  for all
  using (user_id = auth.uid())        -- 読める行
  with check (user_id = auth.uid());  -- 書ける行
```

- `auth.uid()`：今リクエストしている利用者の ID
- すべての表の `user_id` の既定値は `auth.uid()`。利用者のクライアントで insert すれば自動で入る（4.3）

---

## 5. パッケージを入れる

```bash
npm install @supabase/supabase-js @supabase/ssr
npm install -D vitest
```

PR の説明に追加理由を書く（1.7）。

| パッケージ | 理由 |
|---|---|
| `@supabase/supabase-js` | DB・認証 |
| `@supabase/ssr` | Cookie によるセッション管理（Route Handler・proxy） |
| `vitest` | Planning Engine の単体テスト |

---

## 6. Supabase クライアントを作る

### 6.1 利用者用：`lib/server/supabase.ts`（ほぼすべてこれを使う）

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies(); // Next.js 16 では await が必要
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component から呼ばれたときは set できない。proxy が更新するので無視してよい
          }
        },
      },
    },
  );
}
```

Cookie に入っているセッションを読み、「誰として」DB にアクセスするかを決める。

### 6.2 管理用：`lib/server/supabase-admin.ts`（デモ用アカウントの作成だけ）

```ts
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
```

- **RLS を無視できる**ので、使うのは `auth.admin.createUser` の1か所だけ
- seed も含め、データの読み書きには使わない（2.1・4.5）
- `lib/server/` のファイルは画面・components から import しない（1.2）

---

## 7. 認証：requireUser と proxy.ts

### 7.1 `requireUser()`（`lib/server/auth.ts`）

```ts
import { createClient } from "./supabase";
import { HttpError } from "./http";

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "ログインしてください");
  return { user, supabase };
}
```

- `getUser()` は Supabase に問い合わせてトークンを検証する
- `getSession()` は Cookie の中身を検証せずに信じるので、サーバー側の認証チェックには使わない
- 補足：最新の公式ドキュメントでは、JWT の署名をローカルで検証する `getClaims()` も推奨されている。設計書どおり `getUser()` で問題ない

### 7.2 `proxy.ts`（未ログインで画面を開いたら `/login` へ。5.2）

Next.js 16 では middleware ではなく proxy。

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser(); // ここでトークンが更新される
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  return response;
}

export const config = {
  // 対象外：/login、/api/*、/_next/*、拡張子付きのパス
  matcher: ["/((?!login|api|_next|.*\\..*).*)"],
};
```

> `setAll` の中で `response` を作り直す部分は公式の形のまま使う。崩すと更新したトークンがブラウザに返らず、ランダムにログアウトされる。

### 7.3 その他（5.2）

- `app/page.tsx`（`/`）：ログイン済みなら `/today`、未ログインなら `/login` にリダイレクト
- API は proxy の対象外なので、各 Route Handler で `requireUser()` を呼んで 401 を返す
- 画面側は API が 401 を返したら `/login` に移す（14.1）

---

## 8. ログイン API（mock-login）と seed

### 8.1 `POST /api/auth/mock-login`（4.5・5.2）

```ts
const supabase = await createClient();
const email = process.env.DEMO_USER_EMAIL!;
const password = process.env.DEMO_USER_PASSWORD!;

// 1. サインイン
let { data, error } = await supabase.auth.signInWithPassword({ email, password });

// 2. 失敗し、デモモードなら、アカウントを作ってからサインインし直す
if (error && isDemoMode()) {
  await createAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true, // メール確認を飛ばす
  });
  ({ data, error } = await supabase.auth.signInWithPassword({ email, password }));
}
if (error || !data.user) {
  throw new HttpError(500, "INTERNAL", "ログインに失敗しました");
}

// 3. user_settings がなければ seed
const { data: settings } = await supabase
  .from("user_settings")
  .select("display_name")
  .maybeSingle();
if (!settings) await seedDemoUser(supabase, data.user.id);

// レスポンス：{ user_id, display_name }
```

- `signInWithPassword` が成功すると、6.1 の `setAll` 経由でセッションが Cookie に保存される
- リクエストの `email` が文字列なら 400（FR-01-6）

### 8.2 `seedDemoUser(supabase, userId)`（`lib/server/seed.ts`）

**利用者のセッション付きクライアント**で、`mocks/` の内容を次の順に入れる。

| 順 | 表 | 元データ | 備考 |
|---|---|---|---|
| 1 | locations | `mocks/persona.ts` の `LOCATIONS` | |
| 2 | user_settings | `USER_PREFERENCE`、`PERSONA_DISPLAY_NAME` | `home_location_id` = `loc_home` の新 ID、`demo_now` = `2026-10-05T07:00:00+09:00` |
| 3 | travel_times | `TRAVEL_TIMES` | |
| 4 | fixed_events | `FIXED_EVENTS` | |
| 5 | tasks | `TASKS` のうち `goal_id` が null のもの | 目標タスクは入れない |

- モックの ID（`loc_home` など）は `crypto.randomUUID()` の新しい ID に置き換え、置き換え表で参照（`location_id` など）も付け替える
- 目標・計画・ヒアリングは入れない

### 8.3 リセット（`POST /api/mock/reset`。デモモードのみ）

外部キーの都合で、次の順に削除してから `seedDemoUser` を実行する。

`replan_proposals` → `weekly_plans` → `interview_sessions` → `daily_checkins` → `tasks` → `goals` → `fixed_events` → `travel_times` → `user_settings` → `locations`

---

## 9. 読み書き（repositories/）

`lib/server/repositories/` に表ごとの読み書きをまとめる。DB の行 ⇔ スキーマの変換もここで行う（1.2）。

```ts
const { supabase } = await requireUser();

// 読む（RLS で自分の行だけ返る。where user_id は不要）
const { data, error } = await supabase
  .from("tasks")
  .select("*")
  .neq("status", "completed")
  .order("deadline_at", { ascending: true });
if (error) throw error;

// 入れる（user_id は既定値 auth.uid() で自動）
const { data: task, error: insertError } = await supabase
  .from("tasks")
  .insert({ title: "レポート", estimated_minutes: 60 /* ... */ })
  .select()
  .single();

// 変える・消す（他人の行なら 0 行になる → 404 にする）
const { data: updated } = await supabase
  .from("tasks").update({ status: "completed" }).eq("id", id).select();
if (!updated?.length) throw new HttpError(404, "NOT_FOUND", "タスクが見つかりません");

await supabase.from("tasks").delete().eq("id", id);
```

**覚えておくこと**

- エラーは例外にならず `{ data, error }` で返る。毎回 `if (error) throw error` を書くか、ヘルパーを作る
- 他人の行を `update` / `delete` してもエラーにならず、**0行**で終わる。404 を返すには `.select()` で行数を見る
- `.single()` は1行でなければエラー、`.maybeSingle()` は0行なら `null`
- 外部キーの先が自分のデータかは「参照先を自分のクライアントで読めること」で確かめ、読めなければ 400 `INVALID_REQUEST`（4.3）
- `timestamptz` は UTC で返るので、`toJstIso()`（`lib/datetime.ts`）で `+09:00` 付きに変換する（2.1）
- `Date` の `getHours()` などのローカル時刻のメソッドは使わない（Vercel は UTC で動く）
- レスポンスは返す前に必ずスキーマの `.parse()` を通す（2.1）

---

## 10. トランザクション（rpc）

複数の表をまとめて変える操作は、`0002_functions.sql` の SQL 関数を `supabase.rpc()` で呼ぶ（4.4）。

| 関数 | 呼ぶ API |
|---|---|
| `save_generation(p_session_id, p_plans, p_items)` | `POST /api/plans/generate` |
| `select_plan(p_plan_id, p_now)` | `POST /api/plans/{id}/select` |
| `confirm_goal(p_session_id, p_goal, p_tasks)` | `POST /api/interview/confirm` |
| `apply_replan(p_proposal_id)` | `POST /api/plans/replan/accept` |

```ts
const { data: goalId, error } = await supabase.rpc("confirm_goal", {
  p_session_id: sessionId,
  p_goal: { id: crypto.randomUUID(), user_id: userId, created_at: now /* 全列 */ },
  p_tasks: [/* 全列を持つ行 */],
});

if (error) {
  if (error.message.includes("NOT_FOUND")) {
    throw new HttpError(404, "NOT_FOUND", "対象が見つかりません");
  }
  if (error.message.includes("PROPOSAL_EXPIRED")) {
    throw new HttpError(409, "PROPOSAL_EXPIRED", "提案が古くなっています");
  }
  throw error;
}
```

- 関数は `security invoker`：呼んだ本人の権限で動き、RLS も効く
- 実行できるのは `authenticated`（ログイン中の利用者）だけ
- JSON の行は**テーブルの列をすべて**キーに持たせる（`id`・`user_id`・`created_at` も）。足りないキーは null になり、not null の列でエラーになる
- エラーは `raise exception '<CODE>'` で来るので、`message` の CODE を見て 2.2 のエラーに変換する

---

## 11. 動作確認

### 11.1 初回セットアップ

- [ ] SQL Editor で2つのファイルを実行し、Table Editor で13表と鍵のマークを確認した
- [ ] `/login` のボタンを押すと **Authentication → Users** にデモ用ユーザーができる
- [ ] Table Editor の `locations`・`user_settings`・`travel_times`・`fixed_events`・`tasks` に seed の行が入る
- [ ] ログイン後に `/interview` に進む

### 11.2 受け入れテスト（5.3）

- [ ] 未ログインで `/today` を開くと `/login` に移る
- [ ] 未ログインで `GET /api/tasks` が 401
- [ ] 別の利用者のタスク ID で `PATCH /api/tasks/{id}` を呼ぶと 404
- [ ] 新しい Supabase プロジェクトで初めてログインボタンを押すと、デモ用アカウントが作られ、seed が入り、`/interview` に進む
- [ ] 2回目のログインでは seed が重複しない

---

## 12. よくあるハマりどころ

| 症状 | 原因 | 対処 |
|---|---|---|
| select が空配列になる（エラーなし） | RLS で弾かれている | ログインできているか、`user_id` が自分か確かめる |
| insert で `new row violates row-level security policy` | `with check` に引っかかった | 別人の `user_id` を入れていないか確かめる |
| `Email not confirmed` | `createUser` に `email_confirm: true` がない | 付けて作り直す（Users から既存ユーザーを削除） |
| `Invalid API key` | キーの貼り間違い・古いキー | `.env.local` を確かめ、dev サーバーを再起動する |
| 環境変数が `undefined` | `.env.local` を変えたあと再起動していない | `npm run dev` をやり直す |
| ブラウザで Secret key が `undefined` | 正常。`NEXT_PUBLIC_` なしはサーバーでしか読めない | 管理用クライアントはサーバーでだけ使う |
| ときどきログアウトされる | proxy の `setAll` の形が崩れている | 7.2 の形に戻す |
| 日付が9時間ずれる | UTC のまま使っている | `toJstIso()` を通す |
| rpc で not null 制約のエラー | JSON のキーが足りない | 全列のキーを入れる（10章） |
| Vercel でだけ動かない | Vercel に環境変数を入れていない | Settings → Environment Variables に登録し、再デプロイ |
