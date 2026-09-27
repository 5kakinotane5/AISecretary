import { ReplanIntentLlmSchema } from "@/lib/schemas";
import { formatTime } from "@/lib/datetime";
import { callStructured } from "@/lib/llm/client";
import type { ReplanIntentLlm, ReplanTaskOption } from "@/lib/llm/replan-keywords";

// 再計画の意図を LLM で取り出す（plans-replan.md 12.3.1）。LLM_MODE=on のときに使う。
// 出力はキーワード（lib/llm/replan-keywords.ts）と同じ ReplanIntentLlmSchema の形。
// 検証・変換は lib/server/replan-intent.ts の toReplanningIntent() が行う。失敗は LlmError を投げる

const SYSTEM_PROMPT = `あなたはスケジュール管理アプリの再計画の係です。利用者の発言から、今日の予定をどう変えたいか（意図）を1つだけ取り出し、JSON で返します。スケジュールの時間配置はしません。

入力（JSON）：
- text：利用者の発言
- date：今日の日付（YYYY-MM-DD）
- now：現在の日時
- today_tasks：今日の現在以降のタスク（task_id・title・start_time・end_time）

type の選び方（上から順に調べ、最初に当てはまったものを選ぶ）：
1. 疲れている・しんどい・だるい・眠いなど、体調や気分の変化 → "state_change"。fatigue に疲れの度合い（"low"・"medium"・"high"）を入れる。はっきりした疲れは "high"、「少し疲れた」は "medium"
   やる気が出ない・頑張れない（頑張れなそう）・集中できないなど、気分が落ちている → "state_change"、fatigue は "medium"
   「今日は頑張れそうです」のように前向きな発言は変えることがないので "unknown"
2. 「20時から1時間予定が入った」のように、時刻の決まった予定・用事・約束・バイト・会議が新しく入った → "new_fixed_event"。new_fixed_events に入れる
3. 「今日はもう勉強したくない」「もう無理」のように、今日のタスクをやめると言った → "task_change"。やめると言っていない（気分が落ちているだけ）なら 1 にする。today_tasks のすべての task_id を action "postpone" で task_changes に入れる
4. 「ES作成は明日に回したい」のように、特定のタスクを明日に回したい → "task_change"。そのタスクの task_id を action "postpone" で入れる
5. 上のどれにも当てはまらない、または判断できない → "unknown"

決まり：
- 時刻は "HH:MM"（24時間表記。例："20:00"、"09:30"）。「20時半」は "20:30"
- 予定の終わりの時刻が分からなければ end_time は null。「1時間」のように長さだけ分かるときは、開始に足した時刻を end_time に入れる
- 予定の名前が分からなければ title は null
- task_id は today_tasks にあるものだけを使う。作らない。同じ task_id は1回だけ入れる
- 選んだ type に関係のない欄は、fatigue は null、配列は空配列にする
- preference_changes はいつも空配列にする
- 推測で埋めない。迷ったら "unknown"`;

const pad = (n: number) => String(n).padStart(2, "0");
// formatTime は "7:00" の形なので "07:00" にそろえる
const toHhmm = (iso: string) => {
  const [h, m] = formatTime(iso).split(":");
  return `${pad(Number(h))}:${m}`;
};

export async function extractReplanIntentByLlm(
  text: string,
  input: { date: string; now: string; todayTasks: readonly ReplanTaskOption[] },
): Promise<ReplanIntentLlm> {
  return callStructured({
    name: "replan_intent",
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      text,
      date: input.date,
      now: input.now,
      today_tasks: input.todayTasks.map((t) => ({
        task_id: t.task_id,
        title: t.title,
        start_time: toHhmm(t.start_at),
        end_time: toHhmm(t.end_at),
      })),
    }),
    schema: ReplanIntentLlmSchema,
    timeoutMs: 5000,
    retries: 0,
    temperature: 0,
  });
}
