# Personal AI Secretary --- 完成版：Codex投入プロンプト

## 0. 使い方

このファイルは、3日・2〜3人でCodexを使ってMVPを実装するための実行用プロンプト集。

### 原則

-   1プロンプト = 1責務
-   実装前に既存コードを確認
-   既存仕様を壊さない
-   実装後に型チェック・テスト
-   勝手な仕様追加は禁止
-   不明点は推測しない
-   LLMは最終Scheduleを作らない
-   Planning Engineが最終配置を担当する

------------------------------------------------------------------------

# 1. 全プロンプト共通ヘッダー

以下を必要に応じて各Promptの先頭に付ける。

``` text
あなたはこのリポジトリの実装担当です。

まず以下を確認してください。
1. ディレクトリ構成
2. package.json
3. 関連する既存ファイル
4. 既存の型
5. 既存API
6. 既存テスト
7. requirements / docs

既存実装と責務が重複するコードを作らないでください。
仕様を勝手に変更しないでください。
不明な情報は推測せず、既存仕様から判断できる範囲だけ実装してください。

実装後：
1. typecheck
2. lint
3. 関連test
4. 必要ならbuild
を実行してください。

最後に以下を報告してください。
- 変更ファイル
- 実装内容
- テスト結果
- 未実装
- 残リスク

重要：
LLMは自然言語理解・情報抽出・説明を担当します。
最終的なScheduleの時間配置はPlanning Engineだけが担当します。
```

------------------------------------------------------------------------

# 2. Prompt 01 --- 型定義

``` text
Personal AI Secretary MVPの型定義を実装してください。

必要な型：
- User
- UserPreference
- Goal
- Task
- FixedEvent
- DailyCheckIn
- InterviewSession
- GoalTimeCandidate
- FreeSlot
- PlanningContext
- ScheduleItem
- ScheduleCandidate
- DailyPlan
- DailyPlanItem
- ReplanningIntent

requirementsの仕様を優先してください。

特に：
- nullableを勝手に必須化しない
- enumを仕様通りにする
- Interview型とPlanning型を分離
- LLM出力型とDB型を分離
- ID型・時刻型を統一

完了条件：
- typecheck成功
- 型の循環依存なし
- 既存型と重複なし
```

------------------------------------------------------------------------

# 3. Prompt 02 --- DB / Supabase

``` text
MVP用DB schemaとRLSを実装してください。

対象：
users
user_preferences
goals
tasks
fixed_events
daily_checkins
interview_sessions
daily_plans
daily_plan_items

実装：
- migration
- foreign key
- index
- created_at
- updated_at
- user_id
- RLS

要件：
- authenticated userのみ自分のデータを取得・変更できる
- user_idをclient入力だけで信頼しない
- 他ユーザーのIDを指定しても取得できない

DBの責務とPlanning Engineの責務を混ぜないでください。

完了条件：
- migration成功
- RLS確認
- typecheck
- DB関連テスト
```

------------------------------------------------------------------------

# 4. Prompt 03 --- Interview State Machine

``` text
Interview State Machineを実装してください。

状態：
INTERVIEWING
CONFIRMING
COMPLETED
READY_FOR_PLANNING
PLANNING
PLAN_PROPOSED

許可する主な遷移：

INTERVIEWING
→ CONFIRMING
→ COMPLETED
→ READY_FOR_PLANNING

READY_FOR_PLANNING
→ PLANNING
→ PLAN_PROPOSED

重要：
Interview完了だけでPLANNINGへ自動遷移してはいけません。
ユーザーが「スケジュール作成」を実行した場合だけPlanning開始可能にしてください。

不正な遷移はエラーにしてください。

テスト：
- 正常遷移
- 不正遷移
- 重複confirm
- Planning開始条件
```

------------------------------------------------------------------------

# 5. Prompt 04 --- Interview API

``` text
以下を実装してください。

POST /api/interview/start
POST /api/interview/message
POST /api/interview/confirm

各API：
- 認証
- user_id確定
- request validation
- state validation
- response validation
- error response

Interview SessionをDBに保存してください。

clientからuser_idを受け取っても、認証ユーザーとの一致をサーバー側で検証してください。

テスト：
- 未認証
- 他ユーザー
- 不正state
- 不正body
- 正常message
- confirm
```

------------------------------------------------------------------------

# 6. Prompt 05 --- Interview AI

``` text
Interview AIを実装してください。

質問順：
1. カテゴリ
2. Goal
3. Current Status
4. Deadline / Conditions
5. Time Estimation
6. Goal Time 3 Candidates
7. User Selection
8. Summary
9. Final Confirmation

カテゴリ：
- 資格・テスト勉強
- 筋トレ・運動
- 大学の課題・レポート
- 就活
- その他

ルール：
- 1〜2問ずつ
- 不明値を推測しない
- ユーザーに目標時間を一方的に決めない
- 3候補を提示
- ユーザーが選択・編集可能
- Structured Output
- Zod等でvalidation

LLMにScheduleを生成させないでください。

完了条件：
会話から正規化されたGoal候補が取得できる。
```

------------------------------------------------------------------------

# 7. Prompt 06 --- Goal Time 3 Candidates

``` text
Goal Time Candidate生成を実装してください。

候補：
- intensive
- balanced
- paced

基準値baseを使う場合の初期目安：
intensive = base * 1.5
balanced = base
paced = base * 0.5

ただし、deadline、current_level、goal_size、available_time、other_tasks、preferencesを考慮できる構造にしてください。

候補ごとに：
- weekly_hours
- expected_load
- characteristics
- reason

を返してください。

重要：
AIが「正解」を1つ決定してはいけません。
ユーザーが選択・編集します。

テスト：
- deadlineあり
- deadlineなし
- available timeが少ない
- 候補が同一になるケース
```

------------------------------------------------------------------------

# 8. Prompt 07 --- Goal Handoff

``` text
Interview結果をPlanning用の正規化データへ変換してください。

例：

{
  "task_name": "TOEIC学習",
  "target_hours_per_week": 6,
  "frequency": null,
  "deadline": null,
  "priority": "medium",
  "conditions": [],
  "user_selected_plan": "balanced"
}

ルール：
- unknown → null / []
- 推測禁止
- Interview SessionそのものをPlanningへ渡さない
- user_idを保持
- Planning Contextへ変換可能な形式にする

テスト：
- missing deadline
- missing frequency
- user edit
- multiple goals
```

------------------------------------------------------------------------

# 9. Prompt 08 --- Free Slot

``` text
Free Slot生成だけを実装してください。

入力：
- day
- sleep
- fixed events
- locked items
- existing plan

出力：
FreeSlot[]

条件：
- fixed eventと重複なし
- sleepと重複なし
- locked itemと重複なし
- start < end
- 過去に新規配置しない

Task配置はこのPromptでは実装しないでください。

境界条件テストを追加してください。
```

------------------------------------------------------------------------

# 10. Prompt 09 --- Task Priority

``` text
Task Priorityを実装してください。

基本式：

W_i =
α Importance
+ β DeadlineUrgency
+ γ Unfinished
+ δ UserDesire

Deadlineあり：
- 残日数
- remaining work
- importance

Deadlineなし：
- user desire
- continuity
- target gap
- recent progress

係数をconfig化してください。

Priority関数は「どのslotに置くか」を決定してはいけません。
Priorityだけを返してください。

テストを追加してください。
```

------------------------------------------------------------------------

# 11. Prompt 10 --- Task × Slot Fit

``` text
TaskとFreeSlotの適合度を計算してください。

評価：
- duration
- time_of_day
- concentration
- cognitive_load
- splittability
- interruptibility
- current_state

例：
高集中：
report / programming

低集中：
memorization / email /整理

疲労時：
light task / free time

この関数はfit scoreを返し、最終配置は行わないでください。
```

------------------------------------------------------------------------

# 12. Prompt 11 --- Buffer

``` text
Planning EngineにBufferを実装してください。

基本：

Total Time =
Task Time + Buffer + Free Time

Bufferの目的：
- delay absorption
- transition
- rest
- schedule change
- psychological room

重要：
Free Slotを全てTaskで埋めない。

Buffer minimumをconfig化してください。

30分空いているから30分Taskを必ず入れる、という処理は禁止。

テスト：
- 短い空き
- 長い空き
- 疲労高
- Deadline Taskあり
```

------------------------------------------------------------------------

# 13. Prompt 12 --- Schedule Generator

``` text
Planning EngineのSchedule Generatorを実装してください。

処理順を固定：

1. Validate
2. Fixed Events
3. Sleep
4. Free Slots
5. Hard Constraints
6. Task Priority
7. Task × Slot Fit
8. Buffer
9. Candidate Generation
10. Score
11. Validator
12. Return 3 Candidates

Hard Constraint：
- fixed overlapなし
- sleep侵食なし
- task overlapなし
- deadline violationなし
- minimum buffer
- maximum daily work

LLMは使用して最終配置を決定してはいけません。

完了条件：
同じPlanningContextから決定論的に検証可能なScheduleを生成できる。
```

------------------------------------------------------------------------

# 14. Prompt 13 --- Schedule 3 Candidates

``` text
Schedule Candidateを3案生成してください。

Intensive：
重要Task達成を重視。

Balanced：
Task / Buffer / Free Time / Controlを均衡。

Relaxed：
Buffer / Free Time / fatigue fitを重視。

各案：
- plan_type
- items
- task_hours
- buffer_hours
- free_hours
- deadline_task_count
- overload
- explanation

重要：
3案の違いは説明文だけにしない。
実際の配置・Task量・Buffer量・Free Timeが変化するようにしてください。

3案すべてValidatorを通してください。
```

------------------------------------------------------------------------

# 15. Prompt 14 --- Validator

``` text
Schedule Validatorを実装してください。

検証：
- start < end
- item overlap
- fixed event overlap
- sleep overlap
- deadline violation
- buffer minimum
- daily work maximum
- valid task IDs
- valid plan IDs

戻り値：

{
  "valid": false,
  "errors": [
    {
      "code": "FIXED_EVENT_OVERLAP",
      "item_id": "...",
      "message": "..."
    }
  ]
}

booleanだけ返さないでください。

各エラーを再現できるテストを追加してください。
```

------------------------------------------------------------------------

# 16. Prompt 15 --- Plan API

``` text
以下を実装してください。

POST /api/plans/generate
POST /api/plans/:id/select
POST /api/plans/replan

Generate：
- READY_FOR_PLANNINGを確認
- PlanningContext構築
- Planning Engine実行
- 3候補保存
- PLAN_PROPOSEDへ遷移

Select：
- ユーザー選択を保存
- Active Planにする

Replan：
- current plan
- state change
- new fixed event
- task changes
をPlanning Engineへ渡す。

必須：
- auth
- user_id isolation
- Zod validation
- error handling
```

------------------------------------------------------------------------

# 17. Prompt 16 --- Interview Frontend

``` text
既存モックを確認し、そのUI設計を壊さずInterview画面を実装してください。

必要：
- chat
- input
- AI response
- loading
- error
- retry
- stage

Interview終了後：
Goal Time 3 Candidatesを表示。

重要：
Interview終了時にSchedule Generateを自動実行しない。
ユーザーが「スケジュール作成」を押すまでPlanningを開始しない。

実装後に実際の操作フローを確認してください。
```

------------------------------------------------------------------------

# 18. Prompt 17 --- Goal Candidate UI

``` text
Goal Time Candidate 3案をカード表示してください。

各カード：
- name
- weekly hours
- expected load
- characteristics
- reason
- select

選択後：
- hours edit
- confirmation

3案を同等に比較できるUIにしてください。
特定候補だけをAI推薦として過度に強調しないでください。

選択結果がAPIへ正確に送信されることを確認してください。
```

------------------------------------------------------------------------

# 19. Prompt 18 --- Schedule Candidate UI

``` text
Schedule 3 Candidatesを比較表示してください。

表示：
- Intensive
- Balanced
- Relaxed
- task hours
- buffer hours
- free hours
- deadline tasks
- overload
- timeline
- explanation

ユーザーがSelectできるようにしてください。

BufferとFree TimeをTaskと区別して表示してください。
```

------------------------------------------------------------------------

# 20. Prompt 19 --- Today Timeline

``` text
Active PlanをToday Timelineに表示してください。

Item：
- Fixed Event
- Task
- Buffer
- Free Time

各Item：
- start
- end
- type
- title

時間順に表示。

Loading / Empty / Errorを実装してください。

DBの順序ではなくstart timeで並べてください。
```

------------------------------------------------------------------------

# 21. Prompt 20 --- Natural Language Replanning

``` text
自然言語からReplanning Intentだけを抽出してください。

例：
「今日は疲れた」

↓

{
  "type": "state_change",
  "fatigue": "high",
  "task_changes": [],
  "new_fixed_events": [],
  "preference_changes": []
}

LLMの責務：
- intent extraction

LLMの禁止事項：
- Scheduleを直接生成
- Fixed Eventを変更
- Deadlineを変更
- Goalを勝手に変更

抽出後はPlanning Engineへ渡してください。
```

------------------------------------------------------------------------

# 22. Prompt 21 --- Replanning Policy

``` text
Replanning Policyを実装してください。

変更可能：
- 未開始Task
- Optional Task
- Buffer
- Free Time

変更禁止：
- Completed
- Locked
- Fixed Event

「今日は疲れた」の場合：
1. current stateを更新
2. Task × Slot Fit再計算
3. 高負荷Taskを低負荷Taskへ変更可能
4. Free Time増加可能
5. Buffer増加可能
6. 必須Taskは残す

Before / Afterを返してください。
```

------------------------------------------------------------------------

# 23. Prompt 22 --- Feasibility Recovery

``` text
Scheduleが成立しない場合のRecoveryを実装してください。

順番：

1. Mandatory / Deadline Taskを残す
2. Optional Taskを削減
3. Bufferをminimumまで調整
4. それでも不可ならユーザーへ説明

禁止：
- sleep削減
- fixed event削除
- deadline変更
- completed変更
- locked変更

不可能な場合：

{
  "feasible": false,
  "reason": "...",
  "required_changes": [...]
}

を返してください。
```

------------------------------------------------------------------------

# 24. Prompt 23 --- E2E Test

``` text
MVPのDemo PathをE2Eテストしてください。

Login
→ Interview Start
→ Interview
→ Goal Time 3 Candidates
→ User Select
→ Goal Confirm
→ Schedule Generate
→ Schedule 3 Candidates
→ Schedule Select
→ Today Timeline
→ 「今日は疲れた」
→ Replanning
→ Updated Timeline

必須assert：
- Interview後にScheduleが自動生成されない
- 選択GoalがPlanningへ渡る
- 3 Schedule Candidatesが存在
- Bufferが存在
- Fixed Eventが変更されない
- Completedが変更されない
- Lockedが変更されない
- Replanning後にValidatorを通る
```

------------------------------------------------------------------------

# 25. Prompt 24 --- Security Review

``` text
MVPのSecurity Reviewをしてください。

確認：
- Supabase RLS
- user_id isolation
- API auth
- server-side OpenAI key
- OAuth token
- request validation
- logsにtoken/PIIを出していないか
- clientからのuser_id spoofing
- IDOR
- unauthorized mutation

Critical / High / Medium / Lowに分類。

Critical / Highがあれば修正し、修正後に再テストしてください。
```

------------------------------------------------------------------------

# 26. Prompt 25 --- 最終レビュー3段階

``` text
Personal AI Secretary MVPを3段階でレビューしてください。

## Review 1：Completeness
以下が全部あるか確認：
- DB
- API
- Interview
- Goal Candidate
- Goal Handoff
- Planning Engine
- Buffer
- 3 Schedule Candidates
- Today
- Replanning
- Tests

## Review 2：Consistency
以下の責務が混ざっていないか確認：
- LLM
- Interview
- API
- Planning Engine
- Frontend
- DB

特に、
「LLMがScheduleを直接生成していないか」
「Interview完了とPlanning開始が混ざっていないか」
を確認。

## Review 3：Implementation Readiness
以下を確認：
- typecheck
- lint
- unit test
- integration test
- E2E
- build
- env
- migration
- RLS

各問題をCritical / High / Medium / Lowで分類してください。

Critical / Highは可能な限りその場で修正し、修正後に再実行してください。

最後に：
1. Demo Pathが通るか
2. 通らない場合の具体的な箇所
3. 残リスク
4. 3日後にDemo可能か

を報告してください。
```

------------------------------------------------------------------------

# 27. Day別Codex投入順

## Day 1

### A

``` text
01 → 02 → 03 → 04 → 05 → 06
```

### B

``` text
01 → 08 → 09 → 10 → 11
```

### C

``` text
16 → 17
```

### Day 1終端

3人全員が以下を確認：

``` text
A：Interview単体
B：Planning単体
C：UI単体
```

------------------------------------------------------------------------

## Day 2

### A

``` text
07 → 15
```

### B

``` text
12 → 13 → 14
```

### C

``` text
18 → 19
```

### 全員

``` text
23
```

Day 2終了時点でDemo Pathの⑧「Today」まで通す。

------------------------------------------------------------------------

## Day 3

### A

``` text
20 → 21
```

### B

``` text
22
```

### C

Replanning UI + Before/After

### 全員

``` text
23 → 24 → 25
```

------------------------------------------------------------------------

# 28. Codexへの投入時の追加ルール

## ルール1：大きなPromptを一気に投げない

悪い例：

``` text
全部作って
```

良い例：

``` text
Prompt 08だけ実装
↓
test
↓
完了
↓
Prompt 09
```

------------------------------------------------------------------------

## ルール2：完了条件を必ず確認

Codexが「実装しました」と言っても、

``` text
typecheck
test
build
```

を実行する。

------------------------------------------------------------------------

## ルール3：統合前に契約を固定

特に以下はDay 1で固定：

``` text
GoalTimeCandidate
PlanningContext
ScheduleCandidate
ReplanningIntent
```

------------------------------------------------------------------------

## ルール4：Conflictが出たら勝手に統合しない

2人の変更が衝突した場合：

1.  共通型を確認
2.  API契約を確認
3.  責務を確認
4.  最小変更で解決

------------------------------------------------------------------------

## ルール5：16:30以降は新機能禁止

最後は：

``` text
Bug Fix
Integration
Test
Demo
```

を優先。

------------------------------------------------------------------------

# 29. 最終Demo成功条件

以下が1回の操作で通ればMVP完成。

``` text
┌──────────────────┐
│ 目標を相談        │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ Interview AI     │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ 目標時間3案       │
│ Intensive         │
│ Balanced         │
│ Paced            │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ ユーザーが選択    │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ スケジュール作成  │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ Schedule 3案      │
│ Intensive         │
│ Balanced         │
│ Relaxed          │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ ユーザーが選択    │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ Today Timeline   │
│ Task / Buffer    │
│ Free Time        │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ 「今日は疲れた」  │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ Replanning       │
│ Before / After   │
└──────────────────┘
```

この導線を壊す機能追加は、3日間のMVPでは後回しにする。
