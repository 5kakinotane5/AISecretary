import type { z } from "zod";
import {
  INTERVIEW_CATEGORIES,
  InterviewLlmSchema,
  type InterviewExtractedCheckedSchema,
  type InterviewMessage,
  type InterviewStep,
} from "@/lib/schemas";
import { callStructured } from "@/lib/llm/client";

// ヒアリングの抽出＋次の発言を LLM で作る（backend.md 6.2.3）。LLM_MODE=on のときに使う。
// ステップの進行はサーバーが決める。検証（checkExtracted）と進み方（decideNext）は lib/server/interview-llm.ts。
// 失敗は LlmError を投げる（route が 502 にする）

const SYSTEM_PROMPT = `あなたは予定づくりアプリのヒアリング係です。利用者の発言から目標に関する項目を取り出し、次に利用者へ送る発言を1つ作り、JSON で返します。ステップの進め方はアプリが決めます。

入力（JSON）：
- current_step：いま答えてもらっているステップ（category・goal・current_status・conditions）
- next_step：次に聞くステップ（goal・current_status・conditions・time_estimation）
- slots：これまでに取り出した項目
- recent_messages：直近の会話（古い順。role は ai か user）
- text：今回の利用者の発言
- today：今日の日付（YYYY-MM-DD）
- categories：category に使える値

extracted の決まり：
- 今回の発言に書かれていない値は必ず null（conditions は空配列）。推測・補完・一般論での穴埋めをしない
- category：categories のどれかに当てはまるときだけ入れる
- task_name：目標の15文字以内の短い名前（例：TOEIC学習）
- goal_text：目標の内容を発言の言葉のまま短く
- current_status：今の状況（点数・経験・得意や苦手など）を発言の言葉のまま短く
- deadline：YYYY-MM-DD。年がなければ today 以降で最も近い日付にする。「年内」「来月くらい」など日が決まらない表現は null にし、原文を conditions に残す
- conditions：時間帯・回数などの条件を、発言の言葉のまま1件30文字以内で。最大5件
- deadline に入れた期限（日付）は conditions に入れない。deadline を null にした「年内」などの表現だけ原文を残す
- 「週3回」→ frequency_per_week は 3。「週5時間」→ explicit_hours_per_week は 5
- 時間帯は利用者が言った場合だけ入れる：朝・午前 → morning、昼・午後 → daytime、夕方・夜 → evening。「平日は」「土日は」の区別がなければ weekday_time_band と weekend_time_band の両方に同じ値を入れる。原文は conditions にも残す

user_said_unknown：「分からない」「未定」「決めていない」などと答えたら true。それ以外は false

next_message の決まり：
- next_step についての質問だけにする。質問は2個まで
- 丁寧語で、1文を短くする
- 目標時間・スケジュール・曜日の割り当てを提案しない

quick_replies：next_message にそのまま答えられる短い回答の案（各20文字以内、最大5個）。案が作れなければ空配列`;

// LLM に渡すステップ名（6.2.2）。ステップ4の次（time_estimation）の発言はサーバーのテンプレートで作る
export type InterviewLlmStep = Extract<InterviewStep, "category" | "goal" | "current_status" | "conditions">;

export type InterviewLlmInput = {
  current_step: InterviewLlmStep;
  next_step: Extract<InterviewStep, "goal" | "current_status" | "conditions" | "time_estimation">;
  slots: z.infer<typeof InterviewExtractedCheckedSchema>;
  recent_messages: Pick<InterviewMessage, "role" | "text">[];
  text: string;
  today: string;
};

export async function extractInterviewByLlm(input: InterviewLlmInput) {
  return callStructured({
    name: "interview",
    system: SYSTEM_PROMPT,
    user: JSON.stringify({ ...input, categories: INTERVIEW_CATEGORIES }),
    schema: InterviewLlmSchema,
    timeoutMs: 6000,
    retries: 1,
    temperature: 0,
  });
}
