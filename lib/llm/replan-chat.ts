import {
  ReplanChatLlmSchema,
  type PlannedItem,
  type PlanningContext,
  type ReplanChatLlm,
  type ReplanChatRequest,
} from "@/lib/schemas";
import { addDays, formatMonthDay, formatTime, getWeekdayJa, toDateStr } from "@/lib/datetime";
import { callStructured } from "@/lib/llm/client";

// 会話の再計画：計画の呼び出し（replan-chat.md 12.13 ①、予定・タスクを足す：replan-add.md 12.20）。
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
- add_event：新しい予定を入れる（飲み会・面接・ジム・散歩など、タスク一覧にないこと）。title、start（"HH:MM"。今日だけ "now" も使える）、end（"HH:MM"）か minutes（終わりが分からなければ end も minutes も null）、repeat（"once" か "weekly"）、category。once は date（今日〜日曜の "YYYY-MM-DD"。今日なら null でよい）、weekly は weekday（"月"〜"日"）で、date は null
- add_task：締切までに終わらせるタスクを足す。title、minutes（合計の所要時間）、deadline_date（"YYYY-MM-DD"）、deadline_time（"HH:MM"。分からなければ null）、importance・concentration（分からなければ null）
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
- 1つの案の op は7個まで
- 「今から〜したい」：今日・明日以降のタスクにあれば pull_forward（position "first"）か reorder。なければ add_event（start "now"）
- 特定のタスクを明日に・後で（「ワンチャン明日でよくね」「ESは明日でいいや」）：postpone。タスク名が省略されていても today の title から選ぶ
- 無理な要求（残り時間より多いタスクを全部・睡眠を削る・休憩をなくす）：そのままの案は作らない。締切が近い順・重要度の高い順に残し、残りを postpone した「できる範囲で最大」の案を出す
- 睡眠・固定予定・移動・終わった予定・進行中の予定は変えられない（そのための操作もない）
- now が 23:00 以降なら、今日に新しいタスクを入れず postpone を中心にする

# 守ること
- item_id は today・later_tasks にある id だけを使う。作らない
- 時刻は利用者が言った時刻か "now" だけを書く。自分で計算した時刻を書かない
- feedback があれば、前の案がプログラムの検査で通らなかった理由。理由を読んで直した案を出す
- history で前に出した案や利用者の希望を踏まえる

# 予定・タスク・目標の行動の区別
- 予定：時刻が決まっていること（面接・バイト・授業・飲み会・通院・ジム）。add_event。その時間は必ず空ける
- タスク：いつまでに終わらせること（レポート・課題・ES・申込）。add_task。締切までに必ず終える
- 目標の行動：goal が true のタスク（TOEIC の勉強など）。他の2つより緩く、時間が足りないときは減らしてよい
- 目標そのものを変えたい（「英語をもっとやりたい」）は、ここでは変えられない。chat で「設定の『新しい目標を相談する』から変えられます」と伝える
- 今ある予定の取り消し・時刻の変更（「今日のバイトがなくなった」「授業が休講」）は、まだできない。chat でそう伝える

# add_event の書き方
- 1回きり（repeat "once"）：日付は week にある date から選ぶ（「明日」「木曜」「今週の金曜」）。week にない日（来週以降の1回きり）は chat で「今週の予定だけ入れられます」と伝える
- 毎週（repeat "weekly"）：「毎週」「これからずっと」「週1で」と言われたとき。weekday に曜日、date は null。曜日が複数なら op を曜日の数だけ並べる
- 「バイトのある日」「授業の日」のように予定を手がかりに言われたら、week の events を見て当てはまる日を選ぶ。毎週なら、その予定のある曜日ごとに weekly の op を並べる。1回きりなら、今日以降の当てはまる日ごとに once の op を並べる
- 「バイトの後に」「授業の前に」のように時刻を言われなかったら、week の events の終わり・始まりの時刻から決める（後なら終わりの時刻、前なら始まりから minutes を引いた時刻）
- category：授業 "class"、バイト・仕事 "work"、食事 "meal"、友達・飲み会 "social"、家族 "family"、それ以外 "other"
- week の past が true の日（今日より前）に once の予定は入れない

# add_task の書き方
- 締切（deadline_date）と所要時間（minutes）が両方必要。どちらか分からなければ question で1つだけ聞く（例：「いつまでに終わらせたいですか？（例：金曜の夜まで、10/9まで）」「どれくらいかかりそうですか？（例：2時間、30分）」）。推測で埋めない。締切の時刻が分からなければ deadline_time は null
- タスクは長くても分けなくてよい（プログラムが分けて置く）`;

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

  // 今週の月曜〜日曜の固定予定（12.20）。食事・睡眠・移動は入れない。今日より前の日は past: true
  const week = Array.from({ length: 7 }, (_, i) => addDays(context.week_start, i)).map((day) => {
    const items = source.beforeDays.find((entry) => entry.date === day)?.items ?? [];
    const events = items
      .filter((item) => item.kind === "fixed" && item.fixed_category !== "meal")
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
      .map((item) => `${item.title} ${formatTime(item.start_at)}〜${toDateStr(item.end_at) > day ? "24:00" : formatTime(item.end_at)}`);
    return { date: day, weekday: getWeekdayJa(day), ...(day < date ? { past: true } : {}), events };
  });

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
    week,
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
