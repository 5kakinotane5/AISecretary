import {
  ReplanChatLlmSchema,
  type PlannedItem,
  type PlanningContext,
  type ReplanChatLlm,
  type ReplanChatRequest,
} from "@/lib/schemas";
import { addDays, formatMonthDay, formatTime, getWeekdayJa, toDateStr } from "@/lib/datetime";
import { callStructured } from "@/lib/llm/client";

// 会話の再計画：計画の呼び出し（replan-chat.md 12.13 ①）。
// LLM は「何をどう変えるか」を操作で返すだけ。時刻の計算・検査は lib/server/replan-chat/ が行う。失敗は LlmError を投げる

export const REPLAN_CHAT_TIMEOUT_MS = 8000;
const HISTORY_LIMIT = 10;

const SYSTEM_PROMPT = `あなたは大学生の予定を一緒に調整する秘書です。利用者の発言と今日の予定を読み、予定の変え方を「操作」で提案します。
時刻の計算・並べ直し・検査はプログラムが行います。あなたは「何をどう変えるか」だけを決めてください。

# reply_type
- "proposal"：予定を変える案を options に1〜3個入れる
- "question"：何をしたいのか本当に決められないときだけ。text に短い質問を1つ（答えの例を2つ添える）
- "select"：利用者が出ている案を選んだ（「案2で」「2つ目がいい」「それでお願い」）。select_index に1始まりの番号（open_options の index）
- "discard"：利用者が出ている案をやめた（「やっぱりナシ」「元に戻して」「今のままでいい」）
- "chat"：予定を変えない雑談・お礼・前向きな発言。text に短い返事
迷ったら question より proposal（たたき台）を優先する。

# 操作（op）。使わない項目は null か空配列
- add_event：新しい予定を入れる（飲み会・散歩・自習など、今日のタスクにないこと）。title、start（"HH:MM" か "now"）、end（"HH:MM"）か minutes。終わりが分からなければ end も minutes も null
- add_rest：休憩・仮眠を入れる。start（ふつうは "now"）、minutes（仮眠は20、休憩は30が目安）、title（「仮眠」「休憩」）
- delay：今の予定が長引く・電車が遅れるなど。minutes
- reorder：今日の残りのタスクの順番を変える。item_ids に先にやるものから
- shorten：タスクを短くする。item_id、minutes（短くした後の長さ）
- postpone：タスクを今日から外して別の日に回す。item_id、date（希望がなければ null）
- skip：タスクを今週はやめる。item_id
- pull_forward：明日以降のタスクを今日やる。item_id、position（"first" か "last"）
- move_to_day：タスクを指定の日に移す。item_id、date
- tired_plan：疲れ・眠い・だるい・やる気が出ないときの「今夜を軽くする」標準の組み直し。この操作は1つの案に単独で入れる

# 案の作り方
- 案が複数なら、考え方を変える（例：「仮眠してから続ける」と「今夜は軽めにする」）。label は12文字以内の日本語
- 体調・気分（疲れた・眠い・だるい・やる気が出ない・頭が回らない）：tired_plan の案と、add_rest の案の2つを基本にする。fatigue に疲れの度合いを入れる（はっきり疲れている "high"、少し・気分が落ちている "medium"）
- 予定が入った：add_event だけでよい。重なるタスクはプログラムが後ろに回す
- 「今から〜したい」：今日・明日以降のタスクにあれば pull_forward（position "first"）か reorder。なければ add_event（start "now"）
- 特定のタスクを明日に・後で（「ワンチャン明日でよくね」「ESは明日でいいや」）：postpone。タスク名が省略されていても today の title から選ぶ
- 無理な要求（残り時間より多いタスクを全部・睡眠を削る・休憩をなくす）：そのままの案は作らない。締切が近い順・重要度の高い順に残し、残りを postpone した「できる範囲で最大」の案を出す
- 睡眠・固定予定・移動・終わった予定・進行中の予定は変えられない（そのための操作もない）
- now が 23:00 以降なら、今日に新しいタスクを入れず postpone を中心にする

# 守ること
- item_id は today・later_tasks にある id だけを使う。作らない
- 時刻は利用者が言った時刻か "now" だけを書く。自分で計算した時刻を書かない
- feedback があれば、前の案がプログラムの検査で通らなかった理由。理由を読んで直した案を出す
- history で前に出した案や利用者の希望を踏まえる`;

export type ReplanChatFeedback = { label: string; errors: string[] };

export type ReplanChatInputSource = {
  context: PlanningContext; // 12.2 の 6 で作ったもの
  beforeDays: readonly { date: string; items: PlannedItem[] }[]; // 12.2 の engineBeforeDays
  text: string;
  history: ReplanChatRequest["history"];
  openOptions: readonly { index: number; label: string }[];
  feedback: readonly ReplanChatFeedback[]; // 再試行のときだけ（1回目は空配列）
};

const pad = (n: number) => String(n).padStart(2, "0");
// "HH:MM"。その日の 24:00（翌日 0:00）は "24:00"
function hhmm(iso: string, date: string): string {
  if (toDateStr(iso) > date) return "24:00";
  const [h, m] = formatTime(iso).split(":");
  return `${pad(Number(h))}:${m}`;
}

// user の JSON（12.13 ①）。キーは英語、値は日本語のまま
export function buildReplanChatInput(source: ReplanChatInputSource) {
  const { context } = source;
  const now = context.now;
  const date = toDateStr(now);
  const sunday = addDays(context.week_start, 6);
  const tasks = new Map(context.tasks.map((task) => [task.id, task]));
  const deadlineOf = (taskId: string | null) => {
    const deadline = taskId ? tasks.get(taskId)?.deadline_at : null;
    return deadline ? formatMonthDay(deadline) : null;
  };

  const todayItems = source.beforeDays.find((day) => day.date === date)?.items ?? [];
  // 今日の now 以降（進行中を含む）。free・buffer は送らない（空きはプログラムが作る）
  const today = todayItems
    .filter((item) => Date.parse(item.end_at) > Date.parse(now) && item.kind !== "free" && item.kind !== "buffer")
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .map((item) => {
      const base = {
        id: item.id,
        kind: item.kind,
        title: item.title,
        start: hhmm(item.start_at, date),
        end: hhmm(item.end_at, date),
      };
      if (item.kind !== "task") return { ...base, can_change: false };
      const task = item.task_id ? tasks.get(item.task_id) : undefined;
      return {
        ...base,
        can_change: !item.locked && item.status !== "completed",
        deadline: deadlineOf(item.task_id),
        goal: Boolean(task?.goal_id),
        importance: task?.importance ?? null,
        concentration: task?.concentration ?? null,
      };
    });

  // 明日〜日曜の locked でない task 項目
  const laterTasks = source.beforeDays
    .filter((day) => day.date > date && day.date <= sunday)
    .flatMap((day) =>
      day.items
        .filter((item) => item.kind === "task" && !item.locked && item.status !== "completed")
        .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
        .map((item) => ({
          id: item.id,
          title: item.title,
          date: day.date,
          start: hhmm(item.start_at, day.date),
          end: hhmm(item.end_at, day.date),
          deadline: deadlineOf(item.task_id),
        })),
    );

  const checkin = context.checkin;
  return {
    now: hhmm(now, date),
    date,
    weekday: getWeekdayJa(date),
    message: source.text,
    history: source.history.slice(-HISTORY_LIMIT),
    open_options: source.openOptions,
    checkin: checkin
      ? { mood: checkin.mood, fatigue: checkin.fatigue, concentration: checkin.concentration }
      : null,
    today,
    later_tasks: laterTasks,
    goals: context.goals.map((goal) => ({
      name: goal.task_name,
      week_target_minutes: context.goal_week_target_minutes[goal.id] ?? null,
    })),
    settings: {
      sleep_start: context.preferences.sleep_start,
      min_buffer_minutes: context.preferences.min_buffer_minutes,
      daily_work_limit_minutes: context.preferences.daily_work_limit_minutes,
    },
    ...(source.feedback.length > 0 ? { feedback: source.feedback } : {}),
  };
}

export async function callReplanChat(
  input: ReturnType<typeof buildReplanChatInput>,
): Promise<ReplanChatLlm> {
  return callStructured({
    name: "replan_chat",
    system: SYSTEM_PROMPT,
    user: JSON.stringify(input),
    schema: ReplanChatLlmSchema,
    timeoutMs: REPLAN_CHAT_TIMEOUT_MS,
    retries: 0,
    temperature: 0.3,
  });
}
