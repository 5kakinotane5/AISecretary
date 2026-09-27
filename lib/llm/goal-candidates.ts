import { GoalCandidateTextsLlmSchema, type GoalPlanStyle } from "@/lib/schemas";
import { callStructured } from "@/lib/llm/client";

// 目標時間3案の文章を LLM で作る（backend.md 7.2.3）。LLM_MODE=on のときに使う。数値はルールで決めたものを渡すだけ。
// 検証とテンプレートへの戻し方は lib/server/goal-candidates.ts の mergeCandidateTexts() が行う。失敗は LlmError を投げる

const SYSTEM_PROMPT = `あなたはスケジュール管理アプリの係です。利用者の目標に対して、週あたりの目標時間の案3つ（intensive・balanced・paced）それぞれの説明文を JSON で返します。時間の数値はすでに決まっています。数値を決めたり変えたりしません。

入力（JSON）：
- hours：各案の週あたりの時間（intensive・balanced・paced）
- task_name：目標の短い名前
- current_status：利用者の今の状況（null なら不明）
- conditions：利用者が話した条件
- deadline：期限（YYYY-MM-DD。null なら期限なし）
- fixed_events_summary：曜日ごとの固定予定の一言（例：「火・土はバイト」。空なら情報なし）

出力：candidates に、intensive・balanced・paced の順で必ず3件。各件は次の4つ：
- characteristics：その案の進め方の特徴
- merit：良いところ
- caution：気をつけること
- reason：どんな人・状況に向いた目安か

決まり：
- 各文は60文字以内。丁寧語で、1文で短く書く
- 時間の数値を書くなら、hours で渡したその案の値だけを使う。1日あたりの時間や回数など、渡していない数値は書かない
- どの案がおすすめか、どの案が優れているかは書かない。3案を対等に説明する
- 入力にない事実（点数・科目・予定など）を作らない`;

export type GoalCandidateTextsLlmInput = {
  hours: Record<GoalPlanStyle, number>;
  task_name: string;
  current_status: string | null;
  conditions: string[];
  deadline: string | null;
  fixed_events_summary: string;
};

export async function generateGoalCandidateTextsByLlm(input: GoalCandidateTextsLlmInput) {
  return callStructured({
    name: "goal_candidate_texts",
    system: SYSTEM_PROMPT,
    user: JSON.stringify(input),
    schema: GoalCandidateTextsLlmSchema,
    timeoutMs: 5000,
    retries: 0,
    temperature: 0.7,
  });
}
