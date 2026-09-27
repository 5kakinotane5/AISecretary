import { GoalTaskNamesLlmSchema } from "@/lib/schemas";
import { callStructured } from "@/lib/llm/client";

// 目標タスクの名前を LLM で作る（backend.md 8.2）。LLM_MODE=on のときに使う。
// 文字数などの検証とテンプレートへの戻し方は lib/server/goal-task-template.ts の resolveGoalTaskNames() が行う。失敗は LlmError を投げる

const SYSTEM_PROMPT = `あなたはスケジュール管理アプリの係です。利用者の目標から、毎週くり返す作業の名前を JSON で返します。スケジュールの時間配置はしません。

入力（JSON）：
- task_name：目標の短い名前
- category：目標のカテゴリ
- conditions：利用者が話した条件（参考）
- has_light：軽い復習の作業を作るか

出力：
- main：メインの作業（まとまった時間で取り組むもの）の名前
- light：軽い復習の作業（短い時間で取り組むもの）の名前。has_light が false なら null

決まり：
- 名前はそれぞれ20文字以内。日本語で短く、何をするか分かる名前にする
- main と light は違う名前にする
- task_name の言葉を入れる
- 例：task_name が「TOEIC学習」→ main「TOEIC リスニング演習」、light「TOEIC 単語」
- 時間・回数・曜日は名前に入れない`;

export type GoalTaskNamesLlmInput = {
  task_name: string;
  category: string;
  conditions: string[];
  has_light: boolean;
};

export async function generateGoalTaskNamesByLlm(input: GoalTaskNamesLlmInput) {
  return callStructured({
    name: "goal_task_names",
    system: SYSTEM_PROMPT,
    user: JSON.stringify(input),
    schema: GoalTaskNamesLlmSchema,
    timeoutMs: 4000,
    retries: 0,
    temperature: 0.3,
  });
}
