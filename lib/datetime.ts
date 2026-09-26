const JST_TIME_ZONE = "Asia/Tokyo";
// Date.getUTCDay() の並び（0=日）に対応させた表示名
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

const dateFieldFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

const hourFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST_TIME_ZONE,
  hour: "numeric",
  hourCycle: "h23",
});

const isoFieldFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "YYYY-MM-DD"（日付のみ）は JST 0時として扱い、フルの ISO 日時文字列はそのまま解釈する */
function toJstInstant(value: string): Date {
  const iso = value.length === 10 ? `${value}T00:00:00+09:00` : value;
  return new Date(iso);
}

function getJstParts(value: string): { year: number; month: number; day: number } {
  const parts = dateFieldFormatter.formatToParts(toJstInstant(value));
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
    day: Number(parts.find((p) => p.type === "day")?.value),
  };
}

function toUtcMidnight({ year, month, day }: { year: number; month: number; day: number }): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** ISO日時・日付文字列から "YYYY-MM-DD"（JST基準）を取り出す */
export function toDateStr(value: string): string {
  const { year, month, day } = getJstParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** JSTの曜日（月, 火, ...）を1文字で返す */
export function getWeekdayJa(dateStr: string): string {
  return WEEKDAYS_JA[toUtcMidnight(getJstParts(dateStr)).getUTCDay()];
}

/** "10月5日（月）" */
export function formatDateLong(dateStr: string): string {
  const { month, day } = getJstParts(dateStr);
  return `${month}月${day}日（${getWeekdayJa(dateStr)}）`;
}

/** "10/5（月）" */
export function formatDateShort(dateStr: string): string {
  const { month, day } = getJstParts(dateStr);
  return `${month}/${day}（${getWeekdayJa(dateStr)}）`;
}

/** "10/9"（締切バッジなど、曜日なしの短い表記） */
export function formatMonthDay(dateStr: string): string {
  const { month, day } = getJstParts(dateStr);
  return `${month}/${day}`;
}

/** "10/5（月）〜10/11（日）" */
export function formatPeriod(startDateStr: string, endDateStr: string): string {
  return `${formatDateShort(startDateStr)}〜${formatDateShort(endDateStr)}`;
}

/** "07:00" */
export function formatTime(isoStr: string): string {
  return timeFormatter.format(toJstInstant(isoStr));
}

/** JSTの時（0〜23）。あいさつ文の出し分けなどに使う */
export function getJstHour(isoStr: string): number {
  // format() は "7時" のように単位が付くため、数字の部分だけを取り出す
  return Number(hourFormatter.formatToParts(toJstInstant(isoStr)).find((p) => p.type === "hour")?.value);
}

/**
 * "13:00–14:30" のような範囲表記。
 * 終了時刻が翌日0:00ちょうど（日をまたいだ末尾）のときは "24:00" と表示する（mock-spec 5.6 の表記に合わせる）。
 */
export function formatTimeRange(startIso: string, endIso: string): string {
  const startLabel = formatTime(startIso);
  const crossesToNextDay = toDateStr(endIso) !== toDateStr(startIso);
  const endLabel = crossesToNextDay && formatTime(endIso) === "0:00" ? "24:00" : formatTime(endIso);
  return `${startLabel}–${endLabel}`;
}

/** "07:00 現在" */
export function formatDemoNow(isoStr: string): string {
  return `${formatTime(isoStr)} 現在`;
}

/** UTC 0時の Date を YYYY-MM-DD にする */
function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** JSTの日付を days 日進める（負数で戻る）。YYYY-MM-DD を返す */
export function addDays(dateStr: string, days: number): string {
  const base = toUtcMidnight(getJstParts(dateStr));
  base.setUTCDate(base.getUTCDate() + days);
  return formatUtcDate(base);
}

/** その日を含む月から months か月進めた（負数で戻る）月の1日（YYYY-MM-DD）を返す */
export function addMonths(dateStr: string, months: number): string {
  const { year, month } = getJstParts(dateStr);
  return formatUtcDate(new Date(Date.UTC(year, month - 1 + months, 1)));
}

/** ISO日時・日付文字列から "YYYY-MM"（JST基準の年月。GET /api/calendar/month の month）を取り出す */
export function toMonthStr(value: string): string {
  return toDateStr(value).slice(0, 7);
}

/** "2026年10月"（month は "YYYY-MM"） */
export function formatYearMonth(month: string): string {
  const { year, month: m } = getJstParts(`${month}-01`);
  return `${year}年${m}月`;
}

/** JSTの日（1〜31） */
export function getDayOfMonth(dateStr: string): number {
  return getJstParts(dateStr).day;
}

/** その日を含む週の月曜日（YYYY-MM-DD）を返す */
export function getWeekStart(dateStr: string): string {
  const sundayStartDow = toUtcMidnight(getJstParts(dateStr)).getUTCDay(); // 0=日
  const daysSinceMonday = (sundayStartDow + 6) % 7;
  return addDays(dateStr, -daysSinceMonday);
}

/** 2つのISO日時の差分（分）。start/end の順序はそのまま計算する */
export function diffMinutes(startIso: string, endIso: string): number {
  return Math.round((toJstInstant(endIso).getTime() - toJstInstant(startIso).getTime()) / 60000);
}

/** 現在時刻を +09:00 付きのISO 8601（JST）で返す（チャットメッセージの created_at など） */
export function nowIsoJst(): string {
  const parts = isoFieldFormatter.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+09:00`;
}

/** ISO日時を、実行環境のタイムゾーンに依存せずJST（秒精度）に変換する。 */
export function toJstIso(value: string): string {
  const parts = isoFieldFormatter.formatToParts(toJstInstant(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+09:00`;
}

/** JSTの日付とHH:MMからISO日時を作る。24:00は翌日00:00に正規化する。 */
export function atJstTime(date: string, time: string): string {
  return time === "24:00"
    ? `${addDays(date, 1)}T00:00:00+09:00`
    : `${date}T${time}:00+09:00`;
}

/** ISO日時をminutes分進める（負数で戻る）。丸めず、JSTで返す。 */
export function addMinutes(value: string, minutes: number): string {
  return toJstIso(new Date(toJstInstant(value).getTime() + minutes * 60000).toISOString());
}

/** ISO日時の差分（分）。15分未満の判定など、秒・ミリ秒を丸めたくない計算に使う。 */
export function diffMinutesExact(startIso: string, endIso: string): number {
  return (toJstInstant(endIso).getTime() - toJstInstant(startIso).getTime()) / 60000;
}

/** 指定した分単位に切り上げ、JSTで返す。秒・ミリ秒と日付境界も考慮する。 */
export function ceilToMinutes(value: string, stepMinutes: number): string {
  if (!Number.isInteger(stepMinutes) || stepMinutes <= 0) {
    throw new RangeError("切り上げの単位は正の整数（分）にしてください");
  }
  const stepMs = stepMinutes * 60000;
  const midnight = toJstInstant(atJstTime(toDateStr(value), "00:00")).getTime();
  const rounded = midnight + Math.ceil((toJstInstant(value).getTime() - midnight) / stepMs) * stepMs;
  return toJstIso(new Date(rounded).toISOString());
}
