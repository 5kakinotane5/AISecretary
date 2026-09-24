# Personal AI Secretary --- 完成版：人割・タスク細分化

## 0. 開発前提

-   開発人数：2〜3人
-   Codexを主な実装手段として使用
-   実稼働：3日
-   稼働開始前にモック・UIの大枠は完成済み
-   MVPの目的は「機能を大量に作ること」ではなく、以下のDemo
    Pathを3日で通すこと

``` text
目標を相談
↓
Interview AIが質問
↓
目標時間3案を提示
↓
ユーザーが選択・調整
↓
「スケジュール作成」
↓
Planning Engineがスケジュール3案を生成
↓
ユーザーが選択
↓
今日の予定を表示
↓
「今日は疲れた」
↓
AIが再計画
↓
変更前後を表示
```

### 最重要方針

-   LLM：自然言語理解・情報抽出・候補説明
-   Planning Engine：最終的な時間配置
-   DB/API：状態とデータの正規化・永続化
-   Frontend：ユーザーが「選ぶ・確認する・変更する」ためのUI
-   ユーザーの確認なしにGoalやScheduleを確定しない

------------------------------------------------------------------------

# 1. 3人の場合の人割

  ----------------------------------------------------------------------------------------------
  人                主担当            副担当            主な成果物
  ----------------- ----------------- ----------------- ----------------------------------------
  A                 AI / Backend / DB Integration       Interview、API、DB、Replanning

  B                 Planning Engine   Backend Test      Goal候補、Scheduler、Buffer、Validator

  C                 Frontend / UX     Integration Test  Interview UI、Schedule
                                                        UI、Today、Replanning
  ----------------------------------------------------------------------------------------------

## 担当境界

### Aが決めるもの

-   Interviewの状態遷移
-   LLMのStructured Output
-   API契約
-   DB保存
-   Replanning Intentの抽出

### Bが決めるもの

-   優先度計算
-   Free Slot
-   Task × Slot Fit
-   Buffer
-   Schedule配置
-   3 Schedule Candidates
-   Validator
-   Replanningの配置ロジック

### Cが決めるもの

-   画面状態
-   入力UI
-   候補比較UI
-   Timeline
-   Before / After
-   Loading / Error / Empty

### 共同で決めるもの

-   API Request / Response
-   TypeScript型
-   Demo Path
-   エラー仕様

------------------------------------------------------------------------

# 2. Day 0：開始前に確認すること

稼働開始前に以下を確定しておく。

-   [ ] Git repository
-   [ ] main/develop等の統合先
-   [ ] `.env.example`
-   [ ] Supabase project
-   [ ] OpenAI API key
-   [ ] Node / package manager
-   [ ] TypeScript / lint / test command
-   [ ] 既存UI
-   [ ] DB migration方式
-   [ ] Demo用seed data

## ブランチ

3人なら：

``` text
feature/interview-ai
feature/planning-engine
feature/frontend
```

統合用：

``` text
integration/mvp
```

2人なら：

``` text
feature/backend-planning
feature/frontend
```

------------------------------------------------------------------------

# 3. Day 1：独立実装を完成させる

## A：AI / Backend

### A-01 型定義

**内容** - Goal - Task - FixedEvent - DailyCheckIn - InterviewSession -
DailyPlan - DailyPlanItem - GoalTimeCandidate - ScheduleCandidate -
ReplanningIntent

**完了条件** - `npm run typecheck`相当が通る -
Interview用型とPlanning用型が分離されている

------------------------------------------------------------------------

### A-02 DB / RLS

**内容** - users - user_preferences - goals - tasks - fixed_events -
daily_checkins - interview_sessions - daily_plans - daily_plan_items

**完了条件** - migration作成 - user_idによるRLS -
他ユーザーのデータが取得できない - created_at / updated_at - 外部キー

------------------------------------------------------------------------

### A-03 Interview State Machine

状態：

``` text
INTERVIEWING
→ CONFIRMING
→ COMPLETED
→ READY_FOR_PLANNING
```

Planning開始後：

``` text
READY_FOR_PLANNING
→ PLANNING
→ PLAN_PROPOSED
```

**重要** Interview完了とSchedule生成を分離する。

**完了条件** - 不正遷移を拒否 - 状態がDBとAPIで一貫

------------------------------------------------------------------------

### A-04 Interview API

``` text
POST /api/interview/start
POST /api/interview/message
POST /api/interview/confirm
```

**完了条件** - 認証済みユーザーのみ - user_idをサーバー側で確定 -
Request validation - Response schema

------------------------------------------------------------------------

### A-05 Interview AI

質問：

1.  カテゴリ
2.  目標
3.  現在の状態
4.  期限・条件
5.  必要時間を考える材料
6.  目標時間3案
7.  ユーザー選択
8.  要約
9.  最終確認

**ルール** - 1〜2問ずつ - 不明値を推測しない -
目標時間を一方的に決定しない - Structured Output - Zod等で検証

------------------------------------------------------------------------

### A-06 Goal Handoff

InterviewからPlanningへ：

``` json
{
  "task_name": "TOEIC学習",
  "target_hours_per_week": 6,
  "frequency": null,
  "deadline": null,
  "priority": "medium",
  "conditions": [],
  "user_selected_plan": "balanced"
}
```

**完了条件** - unknown → null / \[\] - 会話履歴をPlanning
Engineへ直接渡さない - 正規化済みデータを渡す

------------------------------------------------------------------------

### A-07 Day 1 Aの出口

以下が単体で通る：

``` text
Interview Start
→ Message
→ Goal Candidate
→ User Select
→ Confirm
→ READY_FOR_PLANNING
```

------------------------------------------------------------------------

# 4. B：Planning Engine

## B-01 Planning型

``` text
Task
FixedEvent
FreeSlot
PlanningContext
ScheduleItem
ScheduleCandidate
```

------------------------------------------------------------------------

## B-02 Task Priority

``` text
W_i =
α Importance
+ β DeadlineUrgency
+ γ Unfinished
+ δ UserDesire
```

Deadlineあり： - 残日数 - 残作業量 - 重要度

Deadlineなし： - 希望度 - 継続性 - 目標との差 - 最近の実施状況

------------------------------------------------------------------------

## B-03 Free Slot

固定予定・睡眠・Locked Itemを除外。

**Hard Constraint**

-   start \< end
-   fixed eventと重複なし
-   sleepと重複なし
-   過去時間を新規配置しない

------------------------------------------------------------------------

## B-04 Task × Slot Fit

評価要素：

-   所要時間
-   時間帯
-   集中力
-   認知負荷
-   分割可能性
-   割り込み耐性
-   Check-in状態

------------------------------------------------------------------------

## B-05 Buffer

``` text
Total Time =
Task Time + Buffer + Free Time
```

**禁止** - 空き時間を全部Taskで埋める

Bufferの用途： - 遅延 - 移動 - 休憩 - 予定変更 - 心理的余裕

------------------------------------------------------------------------

## B-06 Schedule Generator

処理順：

``` text
Validate
↓
Fixed Events
↓
Sleep
↓
Free Slots
↓
Hard Constraints
↓
Task Priority
↓
Task × Slot Fit
↓
Buffer
↓
Candidate Generation
↓
Score
↓
Validator
```

------------------------------------------------------------------------

## B-07 3 Schedule Candidates

### Intensive

重要Task達成を重視。

### Balanced

Task / Buffer / Free Time / Controlを均衡。

### Relaxed

Buffer / Free Time / 疲労状態を重視。

**3案は説明文だけ変えてはいけない。**
実際の配置・作業量・余白が変わること。

------------------------------------------------------------------------

## B-08 Score

``` text
Score =
α DeadlineScore
+ β UserIntentScore
+ γ TaskFitScore
+ δ BufferFitScore
+ ε ControlScore
+ ζ ProgressScore
+ η SocialTimeScore
- λ OverloadPenalty
```

係数はconfig化。

------------------------------------------------------------------------

## B-09 Validator

検証：

-   重複
-   Fixed Event侵食
-   Sleep侵食
-   Deadline違反
-   Buffer不足
-   Daily Work超過
-   不正ID
-   start \>= end

------------------------------------------------------------------------

## B-10 Day 1 Bの出口

仮データで：

``` text
Tasks
→ Free Slots
→ Priority
→ Task × Slot Fit
→ Buffer
→ 3 Plans
→ Validator
```

まで通る。

------------------------------------------------------------------------

# 5. C：Frontend

## C-01 Interview UI

-   Chat
-   User input
-   AI message
-   Loading
-   Error
-   Retry
-   Stage表示

------------------------------------------------------------------------

## C-02 Goal Candidate UI

3カード：

-   Intensive
-   Balanced
-   Paced

表示： - 週時間 - 負荷 - 特徴 - 理由 - Select

選択後： - 編集 - Confirm

------------------------------------------------------------------------

## C-03 Schedule UI骨格

3案： - Intensive - Balanced - Relaxed

表示： - Timeline - Task - Buffer - Free Time - Select

------------------------------------------------------------------------

## C-04 Day 1 Cの出口

Mock APIでもよいので：

``` text
Interview
→ Goal Candidates
→ Select
→ Confirm
```

が操作できる。

------------------------------------------------------------------------

# 6. Day 2：統合日

## A：Backend

### A-08 Goal API

``` text
GET /api/goals
POST /api/goals
PATCH /api/goals/:id
DELETE /api/goals/:id
```

### A-09 Task API

``` text
GET /api/tasks
POST /api/tasks
PATCH /api/tasks/:id
DELETE /api/tasks/:id
```

### A-10 Check-in

``` text
POST /api/checkin
```

### A-11 Plan API

``` text
POST /api/plans/generate
POST /api/plans/:id/select
POST /api/plans/replan
```

### A-12 Planning Context Adapter

InterviewのGoalをPlanningContextへ変換。

### A-13 Day 2 Aの出口

Backend単体：

``` text
Goal
→ PlanningContext
→ Planning Engine
→ DailyPlan Candidates
```

------------------------------------------------------------------------

# 7. B：Day 2

## B-11 実データ統合

入力：

-   Goals
-   Tasks
-   Fixed Events
-   Sleep
-   Daily Check-in
-   Preferences
-   Existing Plan

------------------------------------------------------------------------

## B-12 3案比較データ

各案：

-   task_hours
-   buffer_hours
-   free_hours
-   deadline_task_count
-   overload
-   completed/remaining
-   explanation

------------------------------------------------------------------------

## B-13 Day 2 Bの出口

実データで：

``` text
PlanningContext
→ 3 Schedule Candidates
→ Validator
→ API Response
```

------------------------------------------------------------------------

# 8. C：Day 2

## C-05 Generate導線

Interview完了後：

``` text
READY_FOR_PLANNING
↓
「スケジュール作成」
↓
POST /api/plans/generate
```

**Interview完了だけでは自動生成しない。**

------------------------------------------------------------------------

## C-06 Schedule Candidate

3案を比較。

------------------------------------------------------------------------

## C-07 Select

ユーザーが1案を選択。

------------------------------------------------------------------------

## C-08 Today Timeline

``` text
Fixed Event
Task
Buffer
Free Time
```

を時系列表示。

------------------------------------------------------------------------

## C-09 Day 2出口

ブラウザで：

``` text
Login
→ Interview
→ Goal 3 Candidates
→ Select
→ Confirm
→ Schedule Generate
→ Schedule 3 Candidates
→ Select
→ Today
```

が通る。

------------------------------------------------------------------------

# 9. Day 3：Replanning + 品質

## A：AI / Backend

### A-14 Intent Extraction

例：

「今日は疲れた」

``` json
{
  "type": "state_change",
  "fatigue": "high",
  "task_changes": [],
  "new_fixed_events": [],
  "preference_changes": []
}
```

LLMはIntentのみ抽出。

------------------------------------------------------------------------

### A-15 Replanning API

``` text
POST /api/plans/replan
```

------------------------------------------------------------------------

### A-16 Lock Handling

変更禁止：

-   Completed
-   Locked
-   Fixed Event

変更可能：

-   未開始Task
-   Optional Task
-   Buffer
-   Free Time

------------------------------------------------------------------------

## B：Planning

### B-14 Replanning

トリガー：

-   疲労変更
-   Fixed Event追加
-   Task完了
-   Task延期
-   時間不足

------------------------------------------------------------------------

### B-15 Feasibility Recovery

順番：

``` text
Mandatory / Deadline Task
↓
Optional Task削除
↓
Bufferを最低値まで調整
↓
それでも不可ならユーザーへ説明
```

睡眠・固定予定・締切を勝手に壊さない。

------------------------------------------------------------------------

### B-16 Replanning Test

必ず：

``` text
Before Plan
→ State Change
→ Replan
→ After Plan
```

で検証。

------------------------------------------------------------------------

# 10. C：Day 3

## C-10 Replanning UI

入力：

> 今日は疲れた

結果：

-   Before
-   After
-   変更理由

------------------------------------------------------------------------

## C-11 Difference View

変更された項目だけ強調。

例：

``` text
18:00 TOEIC
↓
18:00 Free Time

20:00 レポート
↓
20:00 軽作業
```

------------------------------------------------------------------------

## C-12 UX最終修正

-   Loading
-   Error
-   Empty
-   Select状態
-   Button
-   Responsive
-   Demo data

------------------------------------------------------------------------

# 11. Day 3の最終出口

以下を人間が実際に操作して確認する。

``` text
① Login
② 目標相談
③ 目標時間3案
④ ユーザー選択
⑤ スケジュール作成
⑥ スケジュール3案
⑦ ユーザー選択
⑧ Today Timeline
⑨ 「今日は疲れた」
⑩ 再計画
⑪ Before / After確認
```

------------------------------------------------------------------------

# 12. 2人の場合

## Person A：Backend + AI + Planning

### Day 1

-   型
-   DB
-   State Machine
-   Interview AI
-   Goal Candidate
-   Free Slot
-   Priority
-   Buffer

### Day 2

-   Schedule Generator
-   Validator
-   API
-   Integration

### Day 3

-   Replanning
-   Tests
-   Bug Fix

## Person B：Frontend + Integration

### Day 1

-   Interview UI
-   Goal Candidate
-   Schedule UI

### Day 2

-   API接続
-   Schedule 3案
-   Today

### Day 3

-   Replanning UI
-   Before/After
-   Demo polish

------------------------------------------------------------------------

# 13. 優先順位

## S：必須

1.  Interview AI
2.  Goal Time 3 Candidates
3.  Goal Handoff
4.  Planning Engine
5.  Buffer
6.  Schedule 3 Candidates
7.  Today Timeline

## A：できればMVPに入れる

8.  Daily Check-in
9.  Replanning
10. Task CRUD
11. Fixed Events

## B：後回し

12. Weekly Review
13. Monthly Review
14. Google Calendar
15. 高度なPersonalization

## C：3日ではやらない

-   完全自動化
-   高度な長期学習
-   複雑な推薦
-   Google Calendarの完全同期
-   高度な分析ダッシュボード

------------------------------------------------------------------------

# 14. 3日間の時間配分

## 毎日

``` text
09:00–09:30 進捗共有
09:30–12:00 実装
12:00–13:00 昼
13:00–16:30 実装
16:30–17:30 統合・テスト
17:30–18:00 Demo確認
```

### ルール

16:30以降に大きな新機能を追加しない。 壊れているDemo
Pathを直すことを優先する。

------------------------------------------------------------------------

# 15. 各タスクの完了定義

「コードを書いた」では完了にしない。

各タスクは：

``` text
実装
↓
型チェック
↓
テスト
↓
API/UI接続確認
↓
担当者がDone
```

までをDoneとする。

------------------------------------------------------------------------

# 16. 統合時のチェックポイント

## Checkpoint 1：Day 1終了

``` text
A：Interview単体OK
B：Planning単体OK
C：UI操作OK
```

## Checkpoint 2：Day 2昼

``` text
Interview
→ Goal
→ Planning
```

が接続。

## Checkpoint 3：Day 2終了

``` text
Login
→ Interview
→ Schedule
→ Today
```

が完成。

## Checkpoint 4：Day 3終了

``` text
Today
→ State Change
→ Replanning
→ Before/After
```

が完成。

------------------------------------------------------------------------

# 17. 3日間で絶対に守ること

-   LLMに最終Scheduleを生成させない
-   不明情報を推測しない
-   Goalを勝手に変更しない
-   Interview直後に自動Schedule生成しない
-   Fixed Eventを変更しない
-   Completed / Lockedを変更しない
-   睡眠を削らない
-   空き時間を全部埋めない
-   3案の違いを説明文だけにしない
-   UI polishでBackend統合を遅らせない
-   新機能追加よりDemo Pathを優先する
