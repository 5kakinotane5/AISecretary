# AI秘書 Planning Engine 数学モデル・3候補生成アルゴリズム

AI秘書が、実行可能なスケジュールを探索し、トレードオフの異なる3候補をユーザーへ提示するための数学モデル・アルゴリズム仕様。

Hard Constraints

Task × Slot Fit

Beam Search

Pareto

Diversity

Preference Learning

## 1. 設計思想

> **Task ≠ Objective**
>
> Taskは「ESをやる」「TOEICを勉強する」などの実行対象。Objectiveは「重要タスクを進める」「締切リスクを下げる」「余裕を残す」など、スケジュールを評価する観点。

AIは唯一の「正解」を決めるのではなく、ハード制約を守りながら合理的な選択肢を生成し、ユーザーがその日の時間の使い方を選択する。

## 2. Planning Engine全体構造

Input → Free Slots → Task × Slot Fit → Beam Search → Hard Constraint → Objective Evaluation → Pareto Frontier → 3方向選択 → Diversity Check → 3候補

$$
\boxed{
\text{Tasks}
\rightarrow
\text{Slots}
\rightarrow
\text{Task-Slot Fit}
\rightarrow
\text{Beam Search}
\rightarrow
\text{Feasible Set}
\rightarrow
\text{Pareto Frontier}
\rightarrow
\text{3 Representative Plans}
}
$$

## 3. 入力と変数

### 3.1 ユーザー状態

$$
\mathbf{s}_t=
[
Fatigue,\,
Concentration,\,
Mood,\,
Motivation,\,
AvailableEnergy
]^T
$$

主に「今日の状態」を表す短期変数。

### 3.2 タスクベクトル

$$
\mathbf{t}_i=
[
Importance,\,
CognitiveLoad,\,
Duration,\,
Splittability,\,
Interruptibility,\,
DeadlineUrgency,\,
UserDesire
]^T
$$

## 4. タスク優先度

$$
W_i=
\alpha P_i+
\beta D_i+
\gamma U_i+
\delta W_i^{user}
$$

| 変数 | 意味 |
| --- | --- |
| \(P_i\) | 重要度 |
| \(D_i\) | 締切の緊急度 |
| \(U_i\) | 未完了・進捗状態 |
| \(W_i^{user}\) | ユーザー自身のやりたい度 |
| \(\alpha,\beta,\gamma,\delta\) | 重み |

**優先度**は「何を優先するか」であり、**Fit**は「いつやるのが適しているか」。両者を分離する。

## 5. Task × Slot Fit

$$
\mathbf{x}^{fit}_{i,t}
=
[
DurationFit,\,
TimeOfDayFit,\,
ConcentrationFit,\,
FatigueFit,\,
Interruptibility,\,
Splittability
]^T
$$

$$
Fit(i,t)=\mathbf{w}^{fitT}\mathbf{x}^{fit}_{i,t}
$$

> 例えば朝の集中力が高いユーザーなら、高認知負荷のESは朝のFitが高く、夜のFitが低くなる。

## 6. ハード制約

- 固定予定との重複禁止

- 睡眠時間への侵入禁止

- 同一時刻への複数タスク配置禁止

- 開始時刻 < 終了時刻

- 最低バッファ量の確保

- 1日の最大作業時間を超えない

- 締切後にタスクを配置しない

- 過去の時刻へ新規タスクを配置しない

- 完了済み・ロック済み予定を勝手に変更しない

$$
\mathcal{S}_{feasible}
=
\{
S\mid
S\text{ satisfies all hard constraints}
\}
$$

> **Hard ConstraintとObjectiveを混ぜない。** 睡眠や固定予定の重複は、通常は「どれくらい重視するか」ではなく、候補から除外する制約として扱う。

## 7. 目的関数

$$
\mathbf{F}(S)
=
[
Achievement,\,
DeadlineSafety,\,
TaskFit,\,
Buffer,\,
FreeTime,\,
Control,\,
Recovery
]^T
$$

| 目的 | 意味 |
| --- | --- |
| Achievement | 重要タスクをどれだけ進めるか |
| DeadlineSafety | 締切遅延リスクをどれだけ下げるか |
| TaskFit | タスクと時間帯・状態の適合度 |
| Buffer | 予定変更・遅延への余裕 |
| FreeTime | 自由・個人時間の確保 |
| Control | 時間を自分でコントロールできる構造 |
| Recovery | 疲労・過負荷を抑える度合い |

### 7.1 Overload

$$
O(S)=
\max\left(0,T_s-T_{\mathrm{comfortable}}\right)^2
$$

### 7.2 時間分解とバッファ

$$
T=T_s+T_b+T_f
$$

$$
T_b\ge B_{\min}
$$

## 8. 候補生成：Beam Search

### 8.1 15分単位

$$
\Delta t=15\text{ minutes}
$$

90分のESなら6スロット、60分のTOEICなら4スロット。

### 8.2 部分スケジュールの展開

$$
Expand(S)=
\{
S+(i,t)\mid(i,t)\text{ is feasible}
\}
$$

タスク配置だけでなく、「何もしない」「休憩・自由時間にする」選択肢も含める。

### 8.3 Beam Width

$$
Beam_k=
TopK\left(Expand(Beam_{k-1})\right)
$$

MVPでは \(K=30\sim100\) 程度から実データで調整する。

### 8.4 探索用部分評価

$$
Score_{partial}(S)=
w_1Achievement+
w_2Fit+
w_3DeadlineSafety+
w_4Buffer+
w_5FreeTime-
w_6Overload
$$

> **役割分担：**Beam Searchは探索を効率化するため。最終的なトレードオフの保持はPareto Optimizationが担当する。

### 8.5 タスク分割

Splittabilityが高いタスクは、120分を「120分一括」「60+60」「45+45+30」など複数パターンで生成する。

### 8.6 今日やらない選択

すべてのタスクを今日実行する必要はない。実行しないことによる締切リスクは `DeadlineSafety` に反映する。

## 9. Pareto Frontier

候補AがBを支配する条件：

$$
A\succ B
\iff
\left[
f_k(A)\ge f_k(B)\ \forall k
\right]
\land
\left[
\exists j,\ f_j(A)>f_j(B)
\right]
$$

$$
\mathcal{P}
=
\{
S\mid S\text{ is non-dominated}
\}
$$

> タスク達成・自由時間・バッファ・回復などは同時に最大化できないため、単一の固定重みだけで一つに決めず、合理的なトレードオフを残す。

## 10. Pareto Frontierから3候補を抽出

### 10.1 3方向

**Achievement型**

$$
D_A=[1.0,1.0,0.6,0.3,0.2,0.7,0.2]
$$

**Balanced型**

$$
D_B=[0.75,0.80,0.85,0.70,0.65,0.90,0.70]
$$

**Recovery型**

$$
D_C=[0.55,0.60,0.80,0.95,0.90,0.90,1.00]
$$

数値はMVPの初期値。実運用データで調整するパラメータ。

### 10.2 各方向に近いPareto解

$$
d(S,D_k)=
\left\|\mathbf{F}(S)-D_k\right\|_2
$$

$$
S_A^*=
\arg\min_{S\in\mathcal P}d(S,D_A)
$$

$$
S_B^*=
\arg\min_{S\in\mathcal P}d(S,D_B)
$$

$$
S_C^*=
\arg\min_{S\in\mathcal P}d(S,D_C)
$$

## 11. 候補間の多様性

### 11.1 目的空間距離

$$
d_F(S_i,S_j)=
\left\|\mathbf{F}(S_i)-\mathbf{F}(S_j)\right\|_2
$$

### 11.2 構造的距離

$$
d_S(S_i,S_j)=
\lambda_1|\mathrm{WorkTime}_i-\mathrm{WorkTime}_j|
+\lambda_2|\mathrm{Buffer}_i-\mathrm{Buffer}_j|
+\lambda_3|\mathrm{FreeTime}_i-\mathrm{FreeTime}_j|
+\lambda_4|\mathrm{TaskCount}_i-\mathrm{TaskCount}_j|
$$

### 11.3 統合距離

$$
D(S_i,S_j)=
\lambda_Fd_F(S_i,S_j)+
\lambda_Sd_S(S_i,S_j)
$$

$$
D(S_i,S_j)\ge D_{\min}
$$

候補が近すぎる場合、各方向の第2候補、第3候補へ切り替える。

## 12. ユーザー状態による適応

$$
D_k=D_k(\mathbf{s}_t)
$$

例えば、

$$
Fatigue\uparrow
\quad\Rightarrow\quad
OverloadPenalty\uparrow
$$

$$
Concentration\downarrow
\quad\Rightarrow\quad
HighCognitiveLoad\ Fit\downarrow
$$

$$
DeadlineUrgency\uparrow
\quad\Rightarrow\quad
DeadlineSafety\text{ の重要性}\uparrow
$$

したがって、3候補は固定的な「頑張る・普通・休む」ではなく、その日の状況に意味のある3つのトレードオフになる。

## 13. ユーザー選択からの学習

$$
\mathbf{w}_t=
\mathbf{w}_{base}+
\mathbf{w}_{user}+
\mathbf{w}_{state}
$$

- \(\mathbf{w}_{base}\)：AI秘書の基本方針

- \(\mathbf{w}_{user}\)：長期的なユーザー嗜好

- \(\mathbf{w}_{state}\)：今日の状態による変化

### 13.1 初期重み例

$$
\mathbf{w}_{base}=
[0.25,0.25,0.15,0.15,0.20]
$$

### 13.2 選択からのPreference Learning

$$
\mathbf{w}_{user}^{T}
\left[
\mathbf{F}(S_A)-\mathbf{F}(S_B)
\right]>0
$$

$$
P(S_A\succ S_B)
=
\sigma\left(
\mathbf{w}^{T}
[\mathbf{F}(S_A)-\mathbf{F}(S_B)]
\right)
$$

$$
\sigma(x)=\frac{1}{1+e^{-x}}
$$

### 13.3 長期嗜好と一時状態の分離

$$
w_{new}=(1-\eta)w_{old}+\eta w_{feedback}
$$

| フィードバック | 学習率例 |
| --- | --- |
| 「今後は朝に勉強したい」 | \(\eta\approx0.15\) |
| 今回の候補Aを選択 | \(\eta\approx0.03\) |
| 「今日は疲れた」 | 長期嗜好は更新しない |

## 14. 実装用擬似コード

```
def generate_three_plans(tasks, fixed_events, user_state):

    slots = calculate_free_slots(fixed_events)
    slots = split_into_15min_slots(slots)

    for task in tasks:
        task.priority = calculate_priority(task, user_state)

    fit_matrix = {}
    for task in tasks:
        for slot in slots:
            fit_matrix[(task.id, slot.id)] = calculate_fit(
                task, slot, user_state
            )

    beam = [empty_schedule()]

    for time_slot in slots:
        expanded = []

        for schedule in beam:
            expanded.append(
                add_free_time(schedule, time_slot)
            )

            for task in tasks:
                if can_place(task, time_slot, schedule):
                    expanded.append(
                        place_task(schedule, task, time_slot)
                    )

        for schedule in expanded:
            schedule.score = partial_score(
                schedule, tasks, user_state
            )

        beam = top_k(expanded, k=50)

    feasible = [
        s for s in beam
        if validate_hard_constraints(s)
    ]

    for schedule in feasible:
        schedule.features = evaluate_objectives(
            schedule, tasks, user_state
        )

    pareto = pareto_filter(feasible)

    directions = generate_directions(
        user_state, tasks
    )

    selected = []

    for direction in directions:
        ranked = sorted(
            pareto,
            key=lambda s: distance(
                s.features, direction
            )
        )

        for candidate in ranked:
            if all(
                schedule_distance(candidate, x) >= MIN_DISTANCE
                for x in selected
            ):
                selected.append(candidate)
                break

    return selected
```

## 15. 最終モデル

$$
\boxed{
S^*
=
Select_3
\left(
Pareto
\left(
BeamSearch
\left(
Generate(T,F,\mathbf{s}_t)
\right)
\right)
\right)
}
$$

$$
\boxed{
\begin{aligned}
\mathcal{S}_0
&=Generate(T,F,\mathbf{s}_t)\\
\mathcal{S}_1
&=\{S\in\mathcal{S}_0:S\text{ satisfies hard constraints}\}\\
\mathcal{P}
&=Pareto(\mathcal{S}_1)\\
S_k^*
&=\arg\min_{S\in\mathcal{P}}d(F(S),D_k)\quad(k=1,2,3)\\
D(S_i,S_j)&\ge D_{\min}
\end{aligned}
}
$$

### 役割分担

| 機能 | 担当 |
| --- | --- |
| 自然言語理解・インタビュー | LLM |
| タスク・条件抽出 | LLM |
| 空き時間計算 | Planning Engine |
| Task × Slot Fit | Planning Engine |
| 候補生成 | Beam Search |
| 制約チェック | Validator |
| 多目的評価 | Objective Engine |
| トレードオフ抽出 | Pareto Optimization |
| 3候補選択 | Direction + Diversity |
| 説明文 | LLM |
| ユーザー嗜好学習 | Preference Learning |

> **核心：**
> LLMが自由に予定を作文するのではなく、
> **LLM → 構造化データ → Planning Engine → 数学的探索 → 3候補 → ユーザー選択**
> という流れにすることで、再現性・検証可能性・ユーザー主体性を両立する。



※ 数式中の重み・閾値・Beam Width等はMVPの初期パラメータであり、実データによる検証・チューニングを前提とする。
