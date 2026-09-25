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
  return Number(hourFormatter.format(toJstInstant(isoStr)));
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

/** JSTの日付を days 日進める（負数で戻る）。YYYY-MM-DD を返す */
export function addDays(dateStr: string, days: number): string {
  const base = toUtcMidnight(getJstParts(dateStr));
  base.setUTCDate(base.getUTCDate() + days);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  const d = String(base.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
