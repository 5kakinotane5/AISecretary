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

// 会話の再計画：LLM の操作（12.9）を計画に当てはめる（replan-chat.md 12.10、予定・タスクを足す：replan-add.md 12.18）。
// 純粋関数（DB・LLM・時計・環境変数に触れない）。時刻の計算・並べ直しはここで行い、検査は check.ts（validatePlan）が行う

type EngineReplanOk = Extract<EngineReplanResult, { ok: true }>;
type Day = { date: string; items: PlannedItem[] };

export type UnplacedTask = {
  task_id: string;
  title: string;
  minutes: number;
  deadline_at: string | null;
  goal_id: string | null; // 目標の行動なら目標の id（check.ts が警告を二重に出さないため）
};

export type ApplyOpsInput = {
  context: PlanningContext; // 12.2 の 6 で作ったもの（locked_items 込み）
  beforeDays: readonly Day[]; // 7日分。表示用の計算（11.3）をかけ、reason_code を付けたもの
  ops: readonly ReplanOpLlm[];
  newId: () => string;
};

export type ApplyOpsResult = {
  result: EngineReplanOk; // buildReplanRows() にそのまま渡せる形
  newFixedEvents: FixedEvent[]; // 1回きり・毎週（recurrence "weekly"）の予定
  newTasks: Task[]; // add_task で作ったタスク
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
  origin: "today" | "later" | "split" | "new"; // later ＝明日以降から外した、split ＝ now で切った後半、new ＝ add_task の1回分
  shortened: boolean;
};
type Overflow = Entry & { date: string | null };
type FixedCategory = FixedEvent["category"];

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
const NEAR_NOW_MINUTES = 5; // 開始が now との差この分以内なら "now" と同じに扱う
const WORK_END_BEFORE_SLEEP_MINUTES = 30;
const REST_DEFAULT_MINUTES = 20;
const DELAY_DEFAULT_MINUTES = 30;
const REST_REASON = "少し休んで、回復してから続けます";
const DELAY_REASON = "前の予定が延びた分をあけました";
const TASK_CHUNK_MINUTES = 90; // add_task を分ける1回の長さの上限
const TASK_MAX_MINUTES = 600;
const TASK_MAX_PER_DAY = 2; // 1日に同じタスクは2回まで
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"] as const; // 月曜始まり
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

// "HH:MM" → "HH:MM"（丸めない。24:00 は読まない）。読めなければ null
function parseExactClock(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
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

// 合計 minutes を90分以下の回に分ける。なるべく均等（5分単位、長い回が先）
function splitTaskMinutes(minutes: number): number[] {
  const count = Math.ceil(minutes / TASK_CHUNK_MINUTES);
  const units = minutes / 5;
  const base = Math.floor(units / count);
  const extra = units - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < extra ? 1 : 0)) * 5);
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
    date !== null && DATE_PATTERN.test(date) && date > today && date <= sunday;
  // 締切が日曜以前（入らなければ errors になる）。目標の行動を譲るのはこのタスクのためだけ（replan-add.md 12.18）
  const hasWeekDeadline = (task: Task | null) => {
    const deadline = deadlineDate(task);
    return deadline !== null && deadline <= sunday;
  };

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
  const newTasks: Task[] = [];
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
  // 項目を外し、その場所を自由時間にする（隣り合う自由時間はまとめる）
  const withoutItem = (items: readonly PlannedItem[], item: PlannedItem): PlannedItem[] => {
    const free = blank({
      kind: "free",
      title: "自由時間",
      start_at: item.start_at,
      end_at: item.end_at,
      location_id: item.location_id,
    });
    return mergeFree(items.map((entry) => (entry.id === item.id ? free : entry)), blank);
  };
  const removeFromLater = (day: Day, item: PlannedItem) => {
    day.items = withoutItem(day.items, item);
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
      // now の前後5分以内の時刻（「18時から」を 18:00 に言われた）は "now" と同じ：進行中のタスクは now で切る
      if (Math.abs(diffMinutesExact(now, parsed)) <= NEAR_NOW_MINUTES) ({ start, split } = resolveNow(true));
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
    // 切る：前半は同じ id で now まで（completed）、後半（終わり − cut）はキューの先頭へ
    if (split) {
      const rest = splitAtNow(split, diffMinutesExact(cut, split.end_at));
      if (rest) queue.unshift(rest);
    }
    return { start, end, split };
  };

  // 進行中のタスクを now で切る（12.10 の決まり 1。replan() の state_change と同じ形）：
  // 前半は同じ id・同じ start_at で end_at = now・locked・completed。後半（minutes 分）の Entry を返す
  const splitAtNow = (task: PlannedItem, minutes: number): Entry | null => {
    anchors = anchors.map((item) => (item.id === task.id ? { ...task, end_at: now, locked: true, status: "completed" as const } : item));
    splitTaskIds.push(task.id);
    if (minutes <= 0) return null;
    return { source: task, sourceDate: today, task: findTask(task.task_id), minutes, earliest: null, origin: "split", shortened: false };
  };
  const inProgressTask = (id: string | null) =>
    anchors.find(
      (item) =>
        item.id === id &&
        item.kind === "task" &&
        item.status !== "completed" &&
        ms(item.start_at) < ms(now) &&
        ms(now) < ms(item.end_at),
    ) ?? null;

  // 予定の終わり：end → start＋minutes → start＋60分（仮置き）
  const endOfEvent = (op: ReplanOpLlm, date: string, start: string): { end: string; provisional: boolean } => {
    const end = parseClock(op.end, date);
    if (end !== null) return { end, provisional: false };
    if (op.minutes !== null && op.minutes > 0) return { end: addMinutes(start, round5(op.minutes)), provisional: false };
    return { end: addMinutes(start, PROVISIONAL_MINUTES), provisional: true };
  };

  // FixedEvent（location は null）と、その予定の項目（アンカー）
  const makeEvent = (
    title: string,
    category: FixedCategory,
    recurrence: FixedEvent["recurrence"],
    start: string,
    end: string,
  ): FixedEvent => {
    const event: FixedEvent = {
      id: input.newId(),
      title,
      category,
      location_id: null,
      start_at: start,
      end_at: end,
      recurrence,
    };
    newFixedEvents.push(event);
    return event;
  };
  const eventItem = (event: FixedEvent): PlannedItem =>
    blank({
      kind: "fixed",
      title: event.title,
      start_at: event.start_at,
      end_at: event.end_at,
      fixed_event_id: event.id,
      fixed_category: event.category,
      locked: true,
      reason: formatReason("FIXED_EVENT_ADDED", { time: formatTime(event.start_at) }),
      reason_code: "FIXED_EVENT_ADDED",
    });

  // 今日に予定を入れる（12.10 の add_event）
  const addEventToday = (op: ReplanOpLlm, title: string, category: FixedCategory, recurrence: FixedEvent["recurrence"]) => {
    let provisional = false;
    const placed = placeBlock(op, title, (start) => {
      const result = endOfEvent(op, today, start);
      provisional = result.provisional;
      return result.end;
    });
    if (!placed) return;
    if (provisional) provisionalEnd = true;
    const item = eventItem(makeEvent(title, category, recurrence, placed.start, placed.end));
    anchors.push(item);
    pending.push({ scope: "today", change_type: "added", before: null, after: [item], moved_to_date: null, reason: item.reason ?? "" });
  };

  // 明日〜日曜の day に予定を入れる（replan-add.md 12.18）。重なるタスクは溢れへ、重なる空き時間は削る
  const addEventOnLaterDay = (
    op: ReplanOpLlm,
    title: string,
    category: FixedCategory,
    recurrence: FixedEvent["recurrence"],
    day: Day,
  ) => {
    const date = day.date;
    const start = parseClock(op.start, date);
    if (start === null) {
      opErrors.push(`${title}の開始時刻「${op.start ?? ""}」が読めません`);
      return;
    }
    const { end, provisional } = endOfEvent(op, date, start);
    if (ms(start) >= ms(end)) {
      opErrors.push(`${title}の終わりが開始より前になっています`);
      return;
    }
    const sleepStart = dayEndOf(day.items, date, atJstTime(date, "00:00"));
    if (ms(end) > ms(sleepStart)) {
      opErrors.push(`${title}（${timeLabel(start, date)}〜${timeLabel(end, date)}）は就寝（${timeLabel(sleepStart, date)}）を過ぎるため入れられません`);
      return;
    }
    const range = { start_at: start, end_at: end };
    const hit = day.items.find((item) => (item.locked || isHardKind(item.kind)) && overlaps(item, range));
    if (hit) {
      opErrors.push(`${hit.title}（${timeLabel(hit.start_at, date)}〜${timeLabel(hit.end_at, date)}）と重なるため入れられません`);
      return;
    }
    if (provisional) provisionalEnd = true;
    // 重なるタスクは外して溢れへ（12.10 の 6 で、その日も候補にして置き直す）
    for (const item of day.items.filter((entry) => entry.kind === "task" && overlaps(entry, range))) {
      removeFromLater(day, item);
      overflow.push({ ...entryOfLater(day, item), date: null });
    }
    // 重なる空き時間（自由時間・バッファ）は削る
    const trimmed = day.items.flatMap((item) => {
      if ((item.kind !== "free" && item.kind !== "buffer") || !overlaps(item, range)) return [item];
      const pieces: PlannedItem[] = [];
      if (ms(item.start_at) < ms(start)) pieces.push({ ...item, id: tmpId(), end_at: start });
      if (ms(end) < ms(item.end_at)) pieces.push({ ...item, id: tmpId(), start_at: end });
      return pieces;
    });
    const item = eventItem(makeEvent(title, category, recurrence, start, end));
    day.items = [...trimmed, item].sort(byStart);
    pending.push({ scope: "other", change_type: "added", before: null, after: [item], moved_to_date: null, reason: item.reason ?? "" });
  };

  // 毎週の予定：今週のその曜日に置けるなら置く。もう過ぎていれば来週の同じ曜日から（replan-add.md 12.18）
  const addWeeklyEvent = (op: ReplanOpLlm, title: string, category: FixedCategory) => {
    if (op.weekday === null) {
      opErrors.push(`${title}の曜日（weekday）がありません`);
      return;
    }
    if (op.start === null || op.start.trim() === "now") {
      opErrors.push(`毎週の予定（${title}）は開始の時刻（HH:MM）で教えてください`);
      return;
    }
    const date = addDays(context.week_start, WEEKDAYS.indexOf(op.weekday));
    const start = parseClock(op.start, date);
    if (start === null) {
      opErrors.push(`${title}の開始時刻「${op.start}」が読めません`);
      return;
    }
    if (date === today && ms(start) >= ms(cut)) {
      addEventToday(op, title, category, "weekly");
      return;
    }
    if (date > today) {
      const day = laterDays.find((entry) => entry.date === date);
      if (day) {
        addEventOnLaterDay(op, title, category, "weekly", day);
        return;
      }
    }
    // 今日より前、または今日でもう始まっている → 今週には置かない。start_at は来週の同じ曜日
    const nextDate = addDays(date, 7);
    const nextStart = parseClock(op.start, nextDate)!;
    const { end, provisional } = endOfEvent(op, nextDate, nextStart);
    if (ms(nextStart) >= ms(end)) {
      opErrors.push(`${title}の終わりが開始より前になっています`);
      return;
    }
    if (provisional) provisionalEnd = true;
    makeEvent(title, category, "weekly", nextStart, end);
  };

  // 締切のあるタスクを作り、90分以下の回に分けて溢れに入れる（replan-add.md 12.18 の add_task）
  const addTask = (op: ReplanOpLlm) => {
    const title = op.title?.trim() ?? "";
    if (title === "") {
      opErrors.push("タスクの名前（title）がありません");
      return;
    }
    if (op.minutes === null || op.minutes <= 0) {
      opErrors.push(`${title}の所要時間（minutes）がありません`);
      return;
    }
    const minutes = Math.ceil(op.minutes / 5) * 5;
    if (minutes > TASK_MAX_MINUTES) {
      opErrors.push(`${title}の所要時間は${TASK_MAX_MINUTES}分までです`);
      return;
    }
    if (op.deadline_date === null || !DATE_PATTERN.test(op.deadline_date)) {
      opErrors.push(`${title}の締切の日付（deadline_date）がありません`);
      return;
    }
    const deadlineClock = parseExactClock(op.deadline_time ?? "23:59");
    if (deadlineClock === null) {
      opErrors.push(`${title}の締切の時刻「${op.deadline_time ?? ""}」が読めません`);
      return;
    }
    const deadlineAt = atJstTime(op.deadline_date, deadlineClock);
    if (ms(deadlineAt) <= ms(now)) {
      opErrors.push(`${title}の締切が過ぎています`);
      return;
    }
    const task: Task = {
      id: input.newId(),
      title,
      goal_id: null,
      deadline_at: deadlineAt,
      estimated_minutes: minutes,
      remaining_minutes: minutes,
      importance: op.importance ?? "medium",
      concentration: op.concentration ?? "medium",
      splittable: true,
      interruptible: true,
      buffer_fit: "low",
      status: "not_started",
    };
    newTasks.push(task);
    tasks.set(task.id, task);
    const source = blank({ kind: "task", title, start_at: cut, end_at: cut, task_id: task.id });
    for (const length of splitTaskMinutes(minutes)) {
      overflow.push({ source, sourceDate: today, task, minutes: length, earliest: null, origin: "new", shortened: false, date: null });
    }
  };

  // ---------- 2. 操作を順に当てはめる ----------
  for (const op of ops) {
    switch (op.op) {
      case "add_event": {
        const title = op.title?.trim() || "予定";
        const category = op.category ?? "other";
        if (op.repeat === "weekly") {
          addWeeklyEvent(op, title, category);
          break;
        }
        const date = op.date ?? today;
        if (date === today) {
          addEventToday(op, title, category, null);
          break;
        }
        const day = isLaterDate(date) ? laterDays.find((entry) => entry.date === date) : undefined;
        if (!day) {
          opErrors.push(`今週（${formatMonthDay(sunday)}まで）の1回きりの予定だけ入れられます。毎週の予定なら入れられます`);
          break;
        }
        if (op.start === null || op.start.trim() === "now") {
          opErrors.push(`今日以外の予定（${title}）は開始の時刻（HH:MM）で教えてください`);
          break;
        }
        addEventOnLaterDay(op, title, category, null, day);
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
        const running = index < 0 ? inProgressTask(op.item_id) : null;
        if (index < 0 && !running) {
          opErrors.push(notInQueue(op.item_id));
          break;
        }
        if (op.date !== null && !isLaterDate(op.date)) {
          opErrors.push(`${op.date}は明日〜日曜の日付ではありません`);
          break;
        }
        if (running) {
          // 進行中のタスク（「このタスク」）：now で切り、残り（終わり − now。replan() の state_change と同じ）を明日以降へ
          const rest = splitAtNow(running, diffMinutesExact(now, running.end_at));
          if (rest) overflow.push({ ...rest, date: op.date });
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
      case "add_task": {
        addTask(op);
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

  // キューを前から順に置き、入らないものを返す
  const placeQueue = (entries: readonly Entry[]): Entry[] => {
    placedToday.length = 0;
    const rest: Entry[] = [];
    let lastEnd = cut;
    for (const entry of entries) {
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
        rest.push(entry);
        continue;
      }
      const end = addMinutes(start, entry.minutes);
      placedToday.push({ entry, item: taskItem(entry, start, end, locationAt(anchors, start, home)) });
      lastEnd = end;
    }
    return rest;
  };
  // 締切が日曜以前のタスクが溢れたら、今日に置いた目標の行動を後ろから1つずつ溢れに回して置き直す（replan-add.md 12.18）。
  // now で切った後半（進行中だったもの）は外さない
  const yielded: Entry[] = [];
  let queueRest = placeQueue(queue);
  while (queueRest.some((entry) => hasWeekDeadline(entry.task))) {
    const last = placedToday
      .filter(({ entry }) => entry.task?.goal_id && entry.origin !== "split")
      .sort((a, b) => ms(b.item.start_at) - ms(a.item.start_at))[0];
    if (!last) break;
    yielded.push(last.entry);
    queueRest = placeQueue(queue.filter((entry) => !yielded.includes(entry)));
  }
  for (const entry of [...queueRest, ...yielded]) overflow.push({ ...entry, date: null });

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
  // add_task の回は、締切が今日か明日なら今日（cut 以降）にも置く
  const todayDay: Day = { date: today, items: todayItems };
  type Placed = { date: string; task: PlannedItem; buffer: PlannedItem | null };

  // 置ける日（早い順）
  const candidateDays = (entry: Overflow): Day[] => {
    if (entry.origin === "new") {
      const deadline = deadlineDate(entry.task)!;
      const tomorrow = addDays(today, 1);
      const first = deadline <= tomorrow ? today : tomorrow;
      return [todayDay, ...laterDays].filter((day) => day.date >= first && day.date <= deadline);
    }
    if (entry.date !== null) return laterDays.filter((day) => day.date === entry.date);
    return laterDays;
  };
  const placeEntry = (entry: Overflow): Placed | null => {
    for (const day of candidateDays(entry)) {
      const placed = placeOnDay(day, entry);
      if (placed) return placed;
    }
    return null;
  };

  // 目標の行動を譲る（replan-add.md 12.18）：候補の日を早い順に見て、その日の目標の行動を後ろから1つずつ外して試す。
  // 入った時点でその日を確定し、外した項目は displaced に入れる（締切のあるものを置いた後に置き直す）。
  // 目標の行動で足りなければ、締切なしのタスクも同じように譲る。locked・now より前の項目は外さない
  const displaced: Overflow[] = [];
  const canYield = (item: PlannedItem, withOptional: boolean) => {
    if (item.kind !== "task" || item.locked || item.status === "completed" || ms(item.start_at) < ms(cut)) return false;
    // now で切った後半（進行中だったタスクの残り）は外さない
    if (placedToday.some((placed) => placed.item.id === item.id && placed.entry.origin === "split")) return false;
    const task = findTask(item.task_id);
    if (task?.goal_id) return true;
    return withOptional && task !== null && task.deadline_at === null;
  };
  const yieldAndPlace = (entry: Overflow): Placed | null => {
    for (const withOptional of [false, true]) {
      for (const day of candidateDays(entry)) {
        const victims = day.items
          .filter((item) => canYield(item, withOptional))
          .sort((a, b) => ms(b.start_at) - ms(a.start_at) || b.id.localeCompare(a.id));
        // 目標の行動が先、締切なしのタスクが後
        victims.sort((a, b) => Number(!findTask(a.task_id)?.goal_id) - Number(!findTask(b.task_id)?.goal_id));
        const trial: Day = { date: day.date, items: day.items };
        const removed: PlannedItem[] = [];
        for (const victim of victims) {
          trial.items = withoutItem(trial.items, victim);
          removed.push(victim);
          const placed = placeOnDay(trial, entry);
          if (!placed) continue;
          day.items = trial.items;
          for (const item of removed) displace(day, item);
          return placed;
        }
      }
    }
    return null;
  };
  const displace = (day: Day, item: PlannedItem) => {
    if (day.date !== today) {
      displaced.push({ ...entryOfLater(day, item), date: null });
      return;
    }
    const index = placedToday.findIndex((placed) => placed.item.id === item.id);
    if (index < 0) return;
    const [placed] = placedToday.splice(index, 1);
    displaced.push({ ...placed.entry, date: null });
  };

  const finish = (entry: Overflow, placed: Placed | null) => {
    const title = entry.source.title;
    if (!placed) {
      unplaced.push({
        task_id: entry.source.task_id ?? entry.source.id,
        title,
        minutes: entry.minutes,
        deadline_at: entry.task?.deadline_at ?? null,
        goal_id: entry.task?.goal_id ?? null,
      });
      if (entry.origin === "new") return; // 元の項目がないので、変更点には記録しない
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
      return;
    }
    const reason = placed.task.reason ?? "";
    if (entry.origin === "new") {
      pending.push({
        scope: placed.date === today ? "today" : "other",
        change_type: "added",
        before: null,
        after: [placed.task],
        moved_to_date: null,
        reason,
      });
      return;
    }
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
  };

  // 締切の早い順 → 締切なし。同じなら元の開始時刻の順（12.10 の決まり 4）
  const sortEntries = (entries: readonly Overflow[]) =>
    [...entries].sort((a, b) => {
      const da = a.task?.deadline_at ?? null;
      const db = b.task?.deadline_at ?? null;
      if (da !== db) {
        if (da === null) return 1;
        if (db === null) return -1;
        return ms(da) - ms(db);
      }
      return ms(a.source.start_at) - ms(b.source.start_at);
    });
  const sortedOverflow = sortEntries(overflow);
  // 締切のあるもの：入らず、締切が日曜以前なら目標の行動を譲ってからもう一度置く
  for (const entry of sortedOverflow.filter((item) => item.task?.deadline_at)) {
    let placed = placeEntry(entry);
    if (!placed && hasWeekDeadline(entry.task)) placed = yieldAndPlace(entry);
    finish(entry, placed);
  }
  // 締切なし（目標の行動・任意）と、譲って外した項目：残りの空きへ
  for (const entry of sortEntries([...sortedOverflow.filter((item) => !item.task?.deadline_at), ...displaced])) {
    finish(entry, placeEntry(entry));
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
  const finalToday = finalizeDay(today, todayDay.items);
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

  return { result: parsed, newFixedEvents, newTasks, opErrors, unplaced, skippedGoalMinutes, splitTaskIds, provisionalEnd };

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

  // 1日の自由時間に置く：[自由時間][バッファ][タスク][バッファ][自由時間]（0分の項目は作らない）。
  // 明日以降のほか、add_task の回は今日（cut 以降）にも置く
  function placeOnDay(day: Day, entry: Entry): { date: string; task: PlannedItem; buffer: PlannedItem | null } | null {
    const items = day.items;
    if (taskTotal(items) + entry.minutes > prefs.daily_work_limit_minutes) return null;
    if (
      entry.origin === "new" &&
      items.filter((item) => item.kind === "task" && item.task_id === entry.task?.id).length >= TASK_MAX_PER_DAY
    ) {
      return null;
    }
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
      const earliest = addMinutes(free.start_at, lead);
      const start = ceilToMinutes(day.date === today ? maxIso(earliest, cut) : earliest, 5);
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
        ...(entry.origin === "new"
          ? { reason: `${formatMonthDay(deadlineAt!)}の締切に間に合うように入れました`, reason_code: null }
          : {
              reason: formatReason("USER_POSTPONED", { taskName: entry.source.title, date: day.date }),
              reason_code: "USER_POSTPONED" as const,
            }),
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
