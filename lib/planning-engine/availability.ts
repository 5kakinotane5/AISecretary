export type MinuteRange = {
  start_minute: number;
  end_minute: number;
};

const MINUTES_PER_DAY = 24 * 60;

function assertRange(range: MinuteRange): void {
  if (
    !Number.isInteger(range.start_minute) ||
    !Number.isInteger(range.end_minute) ||
    range.start_minute < 0 ||
    range.end_minute > MINUTES_PER_DAY ||
    range.start_minute >= range.end_minute
  ) {
    throw new RangeError("時間範囲は0〜1440分の整数で、開始を終了より前にしてください");
  }
}

export function buildAvailableRanges(
  day: MinuteRange,
  blockedRanges: MinuteRange[],
): MinuteRange[] {
  assertRange(day);
  blockedRanges.forEach(assertRange);

  const sortedBlocks = [...blockedRanges].sort(
    (left, right) => left.start_minute - right.start_minute || left.end_minute - right.end_minute,
  );
  const available: MinuteRange[] = [];
  let cursor = day.start_minute;

  for (const block of sortedBlocks) {
    if (block.end_minute <= cursor || block.start_minute >= day.end_minute) continue;

    const blockStart = Math.max(block.start_minute, day.start_minute);
    if (blockStart > cursor) {
      available.push({ start_minute: cursor, end_minute: blockStart });
    }

    cursor = Math.max(cursor, block.end_minute);
    if (cursor >= day.end_minute) break;
  }

  if (cursor < day.end_minute) {
    available.push({ start_minute: cursor, end_minute: day.end_minute });
  }

  return available;
}
