import {
  addDays,
  addMinutes,
  atJstTime,
  ceilToMinutes,
  diffMinutesExact,
  formatMonthDay,
  formatTime,
  toDateStr,
} from "@/lib/datetime";
import {
  EngineReplanResultSchema,
  type EngineReplanResult,
  type FixedEvent,
  type PlannedItem,
  type PlanningContext,
  type ReplanChange,
  type ReplanOpLlm,
  type ScheduleItem,
  type Task,
} from "@/lib/schemas";
import { ReplanDiffBuilder, type ReplanChangeScope } from "@/lib/planning/diff";
import { formatReason } from "@/lib/planning/reasons";

// 会話の再計画：LLM の操作（12.9）を計画に当てはめる（replan-chat.md 12.10）。
// 純粋関数（DB・LLM・時計・環境変数に触れない）。時刻の計算・並べ直しはここで行い、検査は check.ts（validatePlan）が行う

type EngineReplanOk = Extract<EngineReplanResult, { ok: true }>;
type Day = { date: string; items: PlannedItem[] };

export type UnplacedTask = { task_id: string; title: string; minutes: number; deadline_at: string | null };

export type ApplyOpsInput = {
  context: PlanningContext; // 12.2 の 6 で作ったもの（locked_items 込み）
  beforeDays: readonly Day[]; // 7日分。表示用の計算（11.3）をかけ、reason_code を付けたもの
  ops: readonly ReplanOpLlm[];
  newId: () => string;
};

export type ApplyOpsResult = {
  result: EngineReplanOk; // buildReplanRows() にそのまま渡せる形
  newFixedEvents: FixedEvent[];
  opErrors: string[]; // 当てはめられなかった操作（日本語。LLM に返す）
  unplaced: UnplacedTask[];
  skippedGoalMinutes: number; // skip・shorten で今週から外した目標タスクの分
  splitTaskIds: string[]; // now で切った進行中のタスク（validatePlan の allowedInProgressTaskSplitIds に渡す）
  provisionalEnd: boolean; // 終わりの時刻を仮置きした予定がある（補正 C-10）
};

// キュー・溢れに入るタスク
type Entry = {
  source: PlannedItem; // 元の項目（今日・明日以降）
  sourceDate: string;
  task: Task | null;
  minutes: number;
  earliest: string | null; // 元の開始時刻。null なら cut から（12.10 の決まり 2）
  origin: "today" | "later" | "split"; // later ＝明日以降から外した、split ＝ now で切った後半
  shortened: boolean;
};
type Overflow = Entry & { date: string | null };

// 変更点は、id が決まった後で ReplanDiffBuilder に記録する
type PendingChange = {
  scope: ReplanChangeScope;
  change_type: ReplanChange["change_type"];
  before: PlannedItem | null;
  after: PlannedItem[];
  moved_to_date: string | null;
  reason: string;
};

const TMP = "tmp:";
const PROVISIONAL_MINUTES = 60;
const WORK_END_BEFORE_SLEEP_MINUTES = 30;
const REST_DEFAULT_MINUTES = 20;
const DELAY_DEFAULT_MINUTES = 30;
const REST_REASON = "少し休んで、回復してから続けます";
const DELAY_REASON = "前の予定が延びた分をあけました";

const ms = (iso: string) => Date.parse(iso);
const minutesOf = (item: Pick<ScheduleItem, "start_at" | "end_at">) => diffMinutesExact(item.start_at, item.end_at);
const byStart = (a: ScheduleItem, b: ScheduleItem) => ms(a.start_at) - ms(b.start_at) || a.id.localeCompare(b.id);
const isHardKind = (kind: ScheduleItem["kind"]) => kind === "sleep" || kind === "fixed" || kind === "travel";
const overlaps = (a: Pick<ScheduleItem, "start_at" | "end_at">, b: Pick<ScheduleItem, "start_at" | "end_at">) =>
  ms(a.start_at) < ms(b.end_at) && ms(b.start_at) < ms(a.end_at);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round5 = (value: number) => Math.round(value / 5) * 5;
const maxIso = (...values: string[]) => values.reduce((a, b) => (ms(b) > ms(a) ? b : a));
const minIso = (...values: string[]) => values.reduce((a, b) => (ms(b) < ms(a) ? b : a));

// 「19:00」。その日の 24:00（翌日 0:00）は「24:00」
function timeLabel(iso: string, date: string): string {
  return toDateStr(iso) > date ? "24:00" : formatTime(iso);
}

// "HH:MM" → その日の日時（5分に切り上げ）。読めなければ null
function parseClock(value: string | null, date: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) return null;
  return ceilToMinutes(atJstTime(date, `${String(hour).padStart(2, "0")}:${match[2]}`), 5);
}

// その日の終わり：from 以降で最初の睡眠の開始（その日の 0:00 に始まる朝の睡眠は除く）。なければ翌日 0:00
function dayEndOf(items: readonly ScheduleItem[], date: string, from: string): string {
  const midnight = ms(atJstTime(date, "00:00"));
  const sleep = items
    .filter((item) => item.kind === "sleep" && ms(item.start_at) > midnight && ms(item.start_at) >= ms(from))
    .sort(byStart)[0];
  return sleep?.start_at ?? atJstTime(addDays(date, 1), "00:00");
}

// 作業（タスク・バッファ）の終わり：就寝の30分前（replan() の workEnd と同じ。12.10 の決まり 3）
const workEndOf = (dayEnd: string) => addMinutes(dayEnd, -WORK_END_BEFORE_SLEEP_MINUTES);

// t の時点にいる場所（直前の項目の行き先・場所）
function locationAt(items: readonly ScheduleItem[], t: string, home: string): string {
  let location = home;
  for (const item of [...items].sort(byStart)) {
    if (ms(item.start_at) >= ms(t)) break;
    location = item.travel?.to_location_id ?? item.location_id ?? location;
  }
  return location;
}

// [from, to) から items を除いた区間
function gapsOf(items: readonly ScheduleItem[], from: string, to: string): { start: string; end: string }[] {
  const result: { start: string; end: string }[] = [];
  let cursor = from;
  for (const item of [...items].sort(byStart)) {
    if (ms(item.end_at) <= ms(cursor)) continue;
    if (ms(item.start_at) >= ms(to)) break;
    if (ms(item.start_at) > ms(cursor)) result.push({ start: cursor, end: item.start_at });
    cursor = item.end_at;
  }
  if (ms(cursor) < ms(to)) result.push({ start: cursor, end: to });
  return result;
}

// [start, end) の前後のタスクとの間が min_buffer_minutes 以上あるか（Validator の BUFFER_SHORTAGE と同じ見方。
// 睡眠・固定予定・移動をはさめば数えない。自由時間・バッファははさんでも数える）
function bufferOk(items: readonly ScheduleItem[], start: string, end: string, minBuffer: number): boolean {
  const sorted = [...items].sort(byStart);
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const item = sorted[i];
    if (ms(item.end_at) > ms(start)) continue;
    if (isHardKind(item.kind)) break;
    if (item.kind === "task") {
      if (diffMinutesExact(item.end_at, start) < minBuffer) return false;
      break;
    }
  }
  for (const item of sorted) {
    if (ms(item.start_at) < ms(end)) continue;
    if (isHardKind(item.kind)) break;
    if (item.kind === "task") return diffMinutesExact(end, item.start_at) >= minBuffer;
  }
  return true;
}

// 中身も時刻も同じか（id・reason・reason_code は比べない）
function sameContent(a: ScheduleItem, b: ScheduleItem): boolean {
  return (
    a.kind === b.kind &&
    a.title === b.title &&
    ms(a.start_at) === ms(b.start_at) &&
    ms(a.end_at) === ms(b.end_at) &&
    a.location_id === b.location_id &&
    a.task_id === b.task_id &&
    a.fixed_event_id === b.fixed_event_id &&
    a.fixed_category === b.fixed_category &&
    JSON.stringify(a.travel) === JSON.stringify(b.travel) &&
    a.suggested_task_id === b.suggested_task_id &&
    a.locked === b.locked &&
    a.status === b.status
  );
}

const sameItem = (a: PlannedItem, b: PlannedItem) =>
  a.id === b.id && sameContent(a, b) && a.reason === b.reason && a.reason_code === b.reason_code;

export function applyOps(input: ApplyOpsInput): ApplyOpsResult {
  const { context, ops } = input;
  const prefs = context.preferences;
  const minBuffer = prefs.min_buffer_minutes;
  const now = context.now;
  const cut = ceilToMinutes(now, 5);
  const today = toDateStr(now);
  const sunday = addDays(context.week_start, 6);
  const home = context.home_location_id;
  const tasks = new Map(context.tasks.map((task) => [task.id, task]));
  const findTask = (id: string | null) => (id ? (tasks.get(id) ?? null) : null);
  const deadlineDate = (task: Task | null) => (task?.deadline_at ? toDateStr(task.deadline_at) : null);
  const isLaterDate = (date: string | null): date is string =>
    date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) && date > today && date <= sunday;

  const beforeDays: Day[] = structuredClone(input.beforeDays).map((day) => ({
    date: day.date,
    items: [...day.items].sort(byStart),
  }));
  const beforeByDate = new Map(beforeDays.map((day) => [day.date, day.items]));
  const beforeToday = beforeByDate.get(today) ?? [];

  let tmpSeq = 0;
  const tmpId = () => `${TMP}${++tmpSeq}`;
  const blank = (patch: Partial<PlannedItem> & Pick<PlannedItem, "kind" | "title" | "start_at" | "end_at">): PlannedItem => ({
    id: tmpId(),
    location_id: null,
    task_id: null,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
    reason_code: null,
    ...patch,
  });

  const opErrors: string[] = [];
  const pending: PendingChange[] = [];
  const newFixedEvents: FixedEvent[] = [];
  const unplaced: UnplacedTask[] = [];
  const splitTaskIds: string[] = [];
  let skippedGoalMinutes = 0;
  let provisionalEnd = false;

  // ---------- 1. 今日の項目を分ける ----------
  let anchors: PlannedItem[] = [];
  let queue: Entry[] = [];
  const overflow: Overflow[] = [];
  for (const item of beforeToday) {
    const movable = !item.locked && item.status !== "completed";
    if (movable && item.kind === "task" && ms(item.start_at) >= ms(cut)) {
      queue.push({
        source: item,
        sourceDate: today,
        task: findTask(item.task_id),
        minutes: minutesOf(item),
        earliest: item.start_at,
        origin: "today",
        shortened: false,
      });
    } else if (movable && (item.kind === "free" || item.kind === "buffer") && ms(item.start_at) >= ms(cut)) {
      // 作り直す（5 で自由時間・バッファにする）
    } else if (
      movable &&
      (item.kind === "free" || item.kind === "buffer") &&
      ms(item.start_at) < ms(now) &&
      ms(now) < ms(item.end_at)
    ) {
      // now をまたぐ自由時間・バッファは cut で縮めて残す（id は同じ）。now より前に始まるので locked にする（PAST_PLACEMENT を避ける）
      anchors.push({ ...item, end_at: minIso(cut, item.end_at), locked: true });
    } else {
      anchors.push(item);
    }
  }
  const dayEnd = dayEndOf(beforeToday, today, now);
  const workEnd = workEndOf(dayEnd);

  // 明日〜日曜（pull_forward・move_to_day で項目を外す・溢れを置く）
  const laterDays: Day[] = beforeDays.filter((day) => isLaterDate(day.date));
  const findLater = (id: string | null) => {
    for (const day of laterDays) {
      const item = day.items.find(
        (entry) => entry.id === id && entry.kind === "task" && !entry.locked && entry.status !== "completed",
      );
      if (item) return { day, item };
    }
    return null;
  };
  // 明日以降の項目を外し、その場所を自由時間にする（隣り合う自由時間はまとめる）
  const removeFromLater = (day: Day, item: PlannedItem) => {
    const free = blank({
      kind: "free",
      title: "自由時間",
      start_at: item.start_at,
      end_at: item.end_at,
      location_id: item.location_id,
    });
    day.items = mergeFree(day.items.map((entry) => (entry.id === item.id ? free : entry)), blank);
  };
  const entryOfLater = (day: Day, item: PlannedItem): Entry => ({
    source: item,
    sourceDate: day.date,
    task: findTask(item.task_id),
    minutes: minutesOf(item),
    earliest: null,
    origin: "later",
    shortened: false,
  });

  const queueIndex = (id: string | null) => queue.findIndex((entry) => entry.source.id === id);
  const notInQueue = (id: string | null) => `item_id「${id ?? ""}」は今日のこれから変えられるタスクにありません`;

  // "now" の開始：cut を含む進行中のアンカーの終わり。task なら now で切る（12.10 の決まり 1）
  const resolveNow = (allowSplit: boolean): { start: string; split: PlannedItem | null } => {
    let t = cut;
    for (;;) {
      const covering = anchors.find((item) => ms(item.start_at) <= ms(t) && ms(t) < ms(item.end_at));
      if (!covering) return { start: t, split: null };
      if (
        allowSplit &&
        covering.kind === "task" &&
        covering.status !== "completed" &&
        ms(covering.start_at) < ms(now) &&
        ms(now) < ms(covering.end_at)
      ) {
        return { start: t, split: covering };
      }
      t = covering.end_at;
    }
  };

  // add_event・add_rest の時刻を決め、アンカーと重ならないか確かめる
  const placeBlock = (
    op: ReplanOpLlm,
    title: string,
    endOf: (start: string) => string,
  ): { start: string; end: string; split: PlannedItem | null } | null => {
    let start: string;
    let split: PlannedItem | null = null;
    if (op.start === null || op.start.trim() === "now") {
      ({ start, split } = resolveNow(true));
    } else {
      const parsed = parseClock(op.start, today);
      if (parsed === null) {
        opErrors.push(`${title}の開始時刻「${op.start}」が読めません`);
        return null;
      }
      start = parsed;
    }
    const end = endOf(start);
    if (ms(start) < ms(cut)) {
      opErrors.push(`${title}の開始（${timeLabel(start, today)}）はもう過ぎています`);
      return null;
    }
    if (ms(start) >= ms(end)) {
      opErrors.push(`${title}の終わりが開始より前になっています`);
      return null;
    }
    if (ms(end) > ms(dayEnd)) {
      opErrors.push(`${title}（${timeLabel(start, today)}〜${timeLabel(end, today)}）は就寝（${timeLabel(dayEnd, today)}）を過ぎるため入れられません`);
      return null;
    }
    const prefix = split ? { ...split, end_at: now, locked: true, status: "completed" as const } : null;
    const hit = anchors
      .map((item) => (split && item.id === split.id ? prefix! : item))
      .find((item) => overlaps(item, { start_at: start, end_at: end }));
    if (hit) {
      opErrors.push(`${hit.title}（${timeLabel(hit.start_at, today)}〜${timeLabel(hit.end_at, today)}）と重なるため入れられません`);
      return null;
    }
    // 切る：前半は同じ id で now まで（completed）、後半はキューの先頭へ
    if (split && prefix) {
      anchors = anchors.map((item) => (item.id === split.id ? prefix : item));
      splitTaskIds.push(split.id);
      const rest = diffMinutesExact(cut, split.end_at);
      if (rest > 0) {
        queue.unshift({
          source: split,
          sourceDate: today,
          task: findTask(split.task_id),
          minutes: rest,
          earliest: null,
          origin: "split",
          shortened: false,
        });
      }
    }
    return { start, end, split };
  };

  // ---------- 2. 操作を順に当てはめる ----------
  for (const op of ops) {
    switch (op.op) {
      case "add_event": {
        const title = op.title?.trim() || "予定";
        let provisional = false;
        const placed = placeBlock(op, title, (start) => {
          const end = parseClock(op.end, today);
          if (end !== null) return end;
          if (op.minutes !== null && op.minutes > 0) return addMinutes(start, round5(op.minutes));
          provisional = true;
          return addMinutes(start, PROVISIONAL_MINUTES);
        });
        if (!placed) break;
        if (provisional) provisionalEnd = true;
        const event: FixedEvent = {
          id: input.newId(),
          title,
          category: "other",
          location_id: null,
          start_at: placed.start,
          end_at: placed.end,
          recurrence: null,
        };
        newFixedEvents.push(event);
        const reason = formatReason("FIXED_EVENT_ADDED", { time: formatTime(placed.start) });
        const item = blank({
          kind: "fixed",
          title,
          start_at: placed.start,
          end_at: placed.end,
          fixed_event_id: event.id,
          fixed_category: "other",
          locked: true,
          reason,
          reason_code: "FIXED_EVENT_ADDED",
        });
        anchors.push(item);
        pending.push({ scope: "today", change_type: "added", before: null, after: [item], moved_to_date: null, reason });
        break;
      }
      case "add_rest": {
        const title = op.title?.trim() || "休憩";
        const minutes = round5(clamp(op.minutes ?? REST_DEFAULT_MINUTES, 10, 90));
        const placed = placeBlock(op, title, (start) => addMinutes(start, minutes));
        if (!placed) break;
        const item = blank({
          kind: "free",
          title,
          start_at: placed.start,
          end_at: placed.end,
          location_id: locationAt(anchors, placed.start, home),
          reason: REST_REASON,
          reason_code: "REST",
        });
        anchors.push(item);
        pending.push({ scope: "today", change_type: "added", before: null, after: [item], moved_to_date: null, reason: REST_REASON });
        break;
      }
      case "delay": {
        // 進行中のアンカー（種類を問わない）の終わりから。次のアンカーと重なる分は手前で切る
        const minutes = round5(clamp(op.minutes ?? DELAY_DEFAULT_MINUTES, 5, 180));
        const { start } = resolveNow(false);
        const next = anchors.filter((item) => ms(item.start_at) >= ms(start)).sort(byStart)[0];
        const end = minIso(addMinutes(start, minutes), next?.start_at ?? dayEnd, dayEnd);
        if (ms(end) <= ms(start)) break;
        const item = blank({
          kind: "free",
          title: "前の予定の延長",
          start_at: start,
          end_at: end,
          location_id: locationAt(anchors, start, home),
          reason: DELAY_REASON,
        });
        anchors.push(item);
        pending.push({ scope: "today", change_type: "added", before: null, after: [item], moved_to_date: null, reason: DELAY_REASON });
        break;
      }
      case "reorder": {
        const ids = [...new Set(op.item_ids)].filter((id) => queueIndex(id) >= 0);
        if (ids.length === 0) {
          opErrors.push(`並べ替えるタスク（${op.item_ids.join("・") || "なし"}）が今日のこれからの予定にありません`);
          break;
        }
        const front = ids.map((id) => ({ ...queue[queueIndex(id)], earliest: null }));
        queue = [...front, ...queue.filter((entry) => !ids.includes(entry.source.id))];
        break;
      }
      case "shorten": {
        const index = queueIndex(op.item_id);
        if (index < 0) {
          opErrors.push(notInQueue(op.item_id));
          break;
        }
        const entry = queue[index];
        const minutes = op.minutes === null ? null : Math.floor(op.minutes / 5) * 5;
        if (minutes === null || minutes < 10) {
          opErrors.push(`${entry.source.title}は10分より短くできません`);
          break;
        }
        if (minutes >= entry.minutes) {
          opErrors.push(`${entry.source.title}は今${entry.minutes}分のため、${minutes}分には短くなりません`);
          break;
        }
        if (entry.task?.goal_id) skippedGoalMinutes += entry.minutes - minutes;
        queue[index] = { ...entry, minutes, shortened: true };
        break;
      }
      case "postpone": {
        const index = queueIndex(op.item_id);
        if (index < 0) {
          opErrors.push(notInQueue(op.item_id));
          break;
        }
        if (op.date !== null && !isLaterDate(op.date)) {
          opErrors.push(`${op.date}は明日〜日曜の日付ではありません`);
          break;
        }
        const [entry] = queue.splice(index, 1);
        overflow.push({ ...entry, date: op.date });
        break;
      }
      case "skip": {
        const index = queueIndex(op.item_id);
        if (index < 0) {
          opErrors.push(notInQueue(op.item_id));
          break;
        }
        const [entry] = queue.splice(index, 1);
        const deadline = deadlineDate(entry.task);
        // 締切が日曜以前のタスクは postpone と同じにする（締切を守る）
        if (deadline !== null && deadline <= sunday) {
          overflow.push({ ...entry, date: null });
          break;
        }
        if (entry.task?.goal_id) skippedGoalMinutes += entry.minutes;
        pending.push({
          scope: entry.sourceDate === today ? "today" : "other",
          change_type: "removed",
          before: entry.source,
          after: [],
          moved_to_date: null,
          reason: formatReason("USER_SKIPPED", { taskName: entry.source.title }),
        });
        break;
      }
      case "pull_forward": {
        const found = findLater(op.item_id);
        if (!found) {
          opErrors.push(`item_id「${op.item_id ?? ""}」は明日以降の変えられるタスクにありません`);
          break;
        }
        removeFromLater(found.day, found.item);
        const entry = entryOfLater(found.day, found.item);
        if (op.position === "first") queue.unshift(entry);
        else queue.push(entry);
        break;
      }
      case "move_to_day": {
        const index = queueIndex(op.item_id);
        const found = index < 0 ? findLater(op.item_id) : null;
        if (index < 0 && !found) {
          opErrors.push(`item_id「${op.item_id ?? ""}」は今日・明日以降の変えられるタスクにありません`);
          break;
        }
        if (!isLaterDate(op.date)) {
          opErrors.push(`${op.date ?? "日付なし"}は明日〜日曜の日付ではありません`);
          break;
        }
        const entry = index >= 0 ? queue[index] : entryOfLater(found!.day, found!.item);
        const deadline = deadlineDate(entry.task);
        if (deadline !== null && op.date > deadline) {
          opErrors.push(`${entry.source.title}は締切（${formatMonthDay(deadline)}）より後の日に移せません`);
          break;
        }
        if (index >= 0) queue.splice(index, 1);
        else removeFromLater(found!.day, found!.item);
        overflow.push({ ...entry, date: op.date });
        break;
      }
      case "tired_plan": {
        // 12.11 で Engine を呼ぶ。ほかの操作と同じ案には入れられない
        opErrors.push("tired_plan はほかの操作と同じ案に入れられません。tired_plan だけの案にしてください");
        break;
      }
    }
  }

  // ---------- 3・4. 今日の空きにキューを並べる ----------
  const placedToday: { entry: Entry; item: PlannedItem }[] = [];
  const blocking = () => [...anchors, ...placedToday.map((placed) => placed.item)];
  const taskTotal = (items: readonly ScheduleItem[]) =>
    items.filter((item) => item.kind === "task").reduce((sum, item) => sum + minutesOf(item), 0);
  // 今日のバッファ＋自由時間の合計（置いたタスク以外の空きは、5 ですべてバッファ・自由時間になる）
  const todayRest = () =>
    anchors.filter((item) => item.kind === "free" || item.kind === "buffer").reduce((sum, item) => sum + minutesOf(item), 0) +
    gapsOf(anchors, now, dayEnd).reduce((sum, gap) => sum + diffMinutesExact(gap.start, gap.end), 0) -
    placedToday.reduce((sum, placed) => sum + placed.entry.minutes, 0);

  let lastEnd = cut;
  for (const entry of queue) {
    const fitsLimit =
      taskTotal(blocking()) + entry.minutes <= prefs.daily_work_limit_minutes &&
      todayRest() - entry.minutes >= prefs.min_daily_buffer_minutes;
    let start: string | null = null;
    if (fitsLimit) {
      for (
        let t = ceilToMinutes(maxIso(cut, lastEnd, entry.earliest ?? cut), 5);
        ms(addMinutes(t, entry.minutes)) <= ms(workEnd);
        t = addMinutes(t, 5)
      ) {
        const end = addMinutes(t, entry.minutes);
        const items = blocking();
        if (items.some((item) => overlaps(item, { start_at: t, end_at: end }))) continue;
        if (!bufferOk(items, t, end, minBuffer)) continue;
        start = t;
        break;
      }
    }
    if (start === null) {
      overflow.push({ ...entry, date: null });
      continue;
    }
    const end = addMinutes(start, entry.minutes);
    placedToday.push({ entry, item: taskItem(entry, start, end, locationAt(anchors, start, home)) });
    lastEnd = end;
  }

  // ---------- 5. 今日の残りの空き：タスクの後ろのバッファと自由時間 ----------
  const todayItems: PlannedItem[] = blocking();
  for (const { item } of placedToday) {
    const next = blocking()
      .filter((other) => ms(other.start_at) >= ms(item.end_at))
      .sort(byStart)[0];
    const bufferEnd = minIso(addMinutes(item.end_at, minBuffer), next?.start_at ?? workEnd, workEnd);
    if (ms(bufferEnd) > ms(item.end_at)) {
      todayItems.push(
        blank({ kind: "buffer", title: "バッファ", start_at: item.end_at, end_at: bufferEnd, location_id: item.location_id }),
      );
    }
  }
  for (const gap of gapsOf(todayItems, now, dayEnd)) {
    todayItems.push(
      blank({
        kind: "free",
        title: "自由時間",
        start_at: gap.start,
        end_at: gap.end,
        location_id: locationAt(anchors, gap.start, home),
        reason_code: "BUFFER_MERGED",
      }),
    );
  }

  // ---------- 6. 溢れを明日以降に置く ----------
  // 締切の早い順 → 締切なし。同じなら元の開始時刻の順（12.10 の決まり 4）
  const sortedOverflow = [...overflow].sort((a, b) => {
    const da = a.task?.deadline_at ?? null;
    const db = b.task?.deadline_at ?? null;
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return ms(da) - ms(db);
    }
    return ms(a.source.start_at) - ms(b.source.start_at);
  });
  for (const entry of sortedOverflow) {
    const dates = entry.date !== null ? [entry.date] : laterDays.map((day) => day.date);
    let placed: { date: string; task: PlannedItem; buffer: PlannedItem | null } | null = null;
    for (const date of dates) {
      const day = laterDays.find((d) => d.date === date);
      if (!day) continue;
      placed = placeOnDay(day, entry);
      if (placed) break;
    }
    const title = entry.source.title;
    if (!placed) {
      unplaced.push({
        task_id: entry.source.task_id ?? entry.source.id,
        title,
        minutes: entry.minutes,
        deadline_at: entry.task?.deadline_at ?? null,
      });
      const deadline = deadlineDate(entry.task);
      pending.push({
        scope: entry.sourceDate === today ? "today" : "other",
        change_type: "removed",
        before: entry.source,
        after: [],
        moved_to_date: null,
        reason:
          deadline !== null && deadline > sunday
            ? formatReason("NEXT_WEEK", { taskName: title, deadlineAt: entry.task?.deadline_at ?? null })
            : `${title}は今週に入りませんでした`,
      });
      continue;
    }
    const reason = placed.task.reason ?? "";
    pending.push({
      scope: "other",
      change_type: "moved",
      before: entry.source,
      after: [placed.task, ...(placed.buffer ? [placed.buffer] : [])],
      moved_to_date: placed.date,
      reason,
    });
    if (entry.origin === "today") {
      pending.push({ scope: "today", change_type: "moved", before: entry.source, after: [], moved_to_date: placed.date, reason });
    }
  }

  // ---------- 7. id ----------
  const finalById = new Map<string, PlannedItem>();
  const finalizeDay = (date: string, items: readonly PlannedItem[]): PlannedItem[] => {
    const before = beforeByDate.get(date) ?? [];
    const used = new Set(items.filter((item) => !item.id.startsWith(TMP)).map((item) => item.id));
    return [...items].sort(byStart).map((item) => {
      if (!item.id.startsWith(TMP)) return item;
      const match = before.find((original) => !used.has(original.id) && sameContent(original, item));
      let final: PlannedItem;
      if (match) {
        used.add(match.id);
        final = { ...item, id: match.id, reason: match.reason, reason_code: match.reason_code };
      } else {
        final = { ...item, id: input.newId() };
      }
      finalById.set(item.id, final);
      return final;
    });
  };
  const finalToday = finalizeDay(today, todayItems);
  const finalLater = laterDays.map((day) => ({ date: day.date, items: finalizeDay(day.date, day.items) }));
  const resolve = (item: PlannedItem) => finalById.get(item.id) ?? item;

  // ---------- 8. 変更点 ----------
  for (const { entry, item } of placedToday) {
    const after = resolve(item);
    if (entry.origin === "split") continue; // 下の replaced に入れる
    if (entry.origin === "later") {
      pending.push({ scope: "today", change_type: "moved", before: entry.source, after: [after], moved_to_date: today, reason: after.reason ?? "" });
    } else if (entry.shortened) {
      pending.push({ scope: "today", change_type: "shortened", before: entry.source, after: [after], moved_to_date: null, reason: after.reason ?? "" });
    } else if (after.id !== entry.source.id) {
      pending.push({ scope: "today", change_type: "moved", before: entry.source, after: [after], moved_to_date: null, reason: after.reason ?? "" });
    }
  }
  for (const id of splitTaskIds) {
    const original = beforeToday.find((item) => item.id === id)!;
    const prefix = finalToday.find((item) => item.id === id);
    const rest = placedToday.filter((placed) => placed.entry.origin === "split" && placed.entry.source.id === id);
    pending.push({
      scope: "today",
      change_type: "replaced",
      before: original,
      after: [...(prefix ? [prefix] : []), ...rest.map((placed) => resolve(placed.item))],
      moved_to_date: null,
      reason: `${original.title}をいったん区切り、残りを後に回しました`,
    });
  }
  const diff = new ReplanDiffBuilder();
  for (const change of pending) {
    const after = change.after.map(resolve);
    // 溢れが元の場所にそのまま戻ったときは記録しない
    if (change.change_type === "moved" && change.before && after.some((item) => item.id === change.before!.id)) continue;
    diff.record(change.scope, {
      change_type: change.change_type,
      before: change.before,
      after,
      moved_to_date: change.moved_to_date,
      reason: change.reason,
    });
  }

  // ---------- 9. 結果 ----------
  const changedLater = finalLater.filter((day) => {
    const before = beforeByDate.get(day.date) ?? [];
    return before.length !== day.items.length || day.items.some((item, i) => !sameItem(item, before[i]));
  });
  const intent = {
    type: "preference_change" as const,
    fatigue: null,
    task_changes: [],
    new_fixed_events: newFixedEvents,
    preference_changes: [],
  };
  const original = input.beforeDays.find((day) => day.date === today);
  const parsed = EngineReplanResultSchema.parse({
    ok: true,
    proposal: {
      date: today,
      intent,
      before: { date: today, items: original?.items ?? [] },
      after: { date: today, items: finalToday },
      ...diff.build(),
      summary_message: "",
    },
    updated_days: [{ date: today, items: finalToday }, ...changedLater],
  });
  if (!parsed.ok) throw new Error("unreachable");

  return { result: parsed, newFixedEvents, opErrors, unplaced, skippedGoalMinutes, splitTaskIds, provisionalEnd };

  // ---------- 内部の関数 ----------

  // 置いたタスクの項目。今日の中で時刻だけ変わったものは元の reason・reason_code のまま（12.10 の決まり 7）
  function taskItem(entry: Entry, start: string, end: string, location: string): PlannedItem {
    const shortenReason = entry.shortened
      ? formatReason("USER_SHORTENED", { taskName: entry.source.title, minutes: entry.minutes })
      : null;
    return {
      ...entry.source,
      id: tmpId(),
      start_at: start,
      end_at: end,
      location_id: location,
      locked: false,
      status: "planned",
      reason: shortenReason ?? entry.source.reason,
      reason_code: shortenReason ? "USER_SHORTENED" : entry.source.reason_code,
    };
  }

  // 明日以降の1日の自由時間に置く：[自由時間][バッファ][タスク][バッファ][自由時間]（0分の項目は作らない）
  function placeOnDay(day: Day, entry: Entry): { date: string; task: PlannedItem; buffer: PlannedItem | null } | null {
    const items = day.items;
    if (taskTotal(items) + entry.minutes > prefs.daily_work_limit_minutes) return null;
    const rest = items.filter((item) => item.kind === "free" || item.kind === "buffer").reduce((sum, item) => sum + minutesOf(item), 0);
    if (rest - entry.minutes < prefs.min_daily_buffer_minutes) return null;
    const dayWorkEnd = workEndOf(dayEndOf(items, day.date, atJstTime(day.date, "00:00")));
    const deadlineAt = entry.task?.deadline_at ?? null;
    for (const free of items.filter((item) => item.kind === "free" && !item.locked).sort(byStart)) {
      // 直前のタスクとの間が足りなければ、その分のバッファを先に置く
      const previous = [...items]
        .sort(byStart)
        .filter((item) => ms(item.end_at) <= ms(free.start_at))
        .reverse()
        .find((item) => item.kind === "task" || isHardKind(item.kind));
      const lead =
        previous?.kind === "task" ? Math.max(0, minBuffer - diffMinutesExact(previous.end_at, free.start_at)) : 0;
      const start = ceilToMinutes(addMinutes(free.start_at, lead), 5);
      const end = addMinutes(start, entry.minutes);
      const limit = minIso(free.end_at, dayWorkEnd);
      if (ms(end) > ms(limit)) continue;
      if (deadlineAt !== null && ms(end) > ms(deadlineAt)) continue;
      if (!bufferOk(items, start, end, minBuffer)) continue;

      const location = free.location_id;
      const pieces: PlannedItem[] = [];
      const leadStart = addMinutes(start, -lead);
      if (ms(leadStart) > ms(free.start_at)) {
        pieces.push(blank({ kind: "free", title: "自由時間", start_at: free.start_at, end_at: leadStart, location_id: location, reason_code: "BUFFER_MERGED" }));
      }
      if (lead > 0) {
        pieces.push(blank({ kind: "buffer", title: "バッファ", start_at: leadStart, end_at: start, location_id: location }));
      }
      const task: PlannedItem = {
        ...entry.source,
        id: tmpId(),
        start_at: start,
        end_at: end,
        location_id: location,
        locked: false,
        status: "planned",
        reason: formatReason("USER_POSTPONED", { taskName: entry.source.title, date: day.date }),
        reason_code: "USER_POSTPONED",
      };
      pieces.push(task);
      const bufferEnd = minIso(addMinutes(end, minBuffer), limit);
      const buffer =
        ms(bufferEnd) > ms(end)
          ? blank({ kind: "buffer", title: "バッファ", start_at: end, end_at: bufferEnd, location_id: location })
          : null;
      if (buffer) pieces.push(buffer);
      const tailStart = buffer?.end_at ?? end;
      if (ms(tailStart) < ms(free.end_at)) {
        pieces.push(blank({ kind: "free", title: "自由時間", start_at: tailStart, end_at: free.end_at, location_id: location, reason_code: "BUFFER_MERGED" }));
      }
      day.items = items.flatMap((item) => (item.id === free.id ? pieces : [item])).sort(byStart);
      return { date: day.date, task, buffer };
    }
    return null;
  }
}

// 隣り合う自由時間（locked でない・同じ場所）を1つにまとめる。まとめた項目は新しい項目になる
function mergeFree(items: readonly PlannedItem[], blank: (patch: Partial<PlannedItem> & Pick<PlannedItem, "kind" | "title" | "start_at" | "end_at">) => PlannedItem): PlannedItem[] {
  const result: PlannedItem[] = [];
  for (const item of [...items].sort(byStart)) {
    const previous = result[result.length - 1];
    if (
      previous?.kind === "free" &&
      item.kind === "free" &&
      !previous.locked &&
      !item.locked &&
      ms(previous.end_at) === ms(item.start_at) &&
      previous.location_id === item.location_id
    ) {
      result[result.length - 1] = blank({
        kind: "free",
        title: "自由時間",
        start_at: previous.start_at,
        end_at: item.end_at,
        location_id: item.location_id,
        reason_code: "BUFFER_MERGED",
      });
    } else {
      result.push(item);
    }
  }
  return result;
}
