import {
  addDays,
  addMinutes,
  atJstTime,
  diffMinutesExact,
  getWeekdayJa,
  toDateStr,
  toJstIso,
} from "@/lib/datetime";
import type {
  EngineGenerateResult,
  EnginePlan,
  FixedEvent,
  PlannedItem,
  PlanningContext,
} from "@/lib/schemas";

export type FixedEventExpansionOptions = {
  purpose: "planning_context" | "calendar";
};

function moveFixedEventToDate(event: FixedEvent, date: string, id: string): FixedEvent {
  const sourceStart = toJstIso(event.start_at);
  const durationMinutes = diffMinutesExact(event.start_at, event.end_at);
  const start_at = `${date}T${sourceStart.slice(11, 19)}+09:00`;
  return { ...event, id, start_at, end_at: addMinutes(start_at, durationMinutes) };
}

/** backend.md 9.1.2: 指定範囲（両端を含む）へ固定予定を展開する。 */
export function expandFixedEvents(
  events: readonly FixedEvent[],
  fromDate: string,
  toDate: string,
  options: FixedEventExpansionOptions,
): FixedEvent[] {
  if (fromDate > toDate) return [];
  const expanded: FixedEvent[] = [];

  for (const event of events) {
    const sourceDate = toDateStr(event.start_at);
    if (event.recurrence === null) {
      if (sourceDate >= fromDate && sourceDate <= toDate) expanded.push({ ...event });
      continue;
    }

    const sourceWeekday = getWeekdayJa(sourceDate);
    for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
      if (getWeekdayJa(date) !== sourceWeekday) continue;
      const id =
        options.purpose === "planning_context" || date === sourceDate
          ? event.id
          : `${event.id}_${date}`;
      expanded.push(moveFixedEventToDate(event, date, id));
    }
  }

  return expanded.sort((a, b) => {
    if (a.start_at !== b.start_at) return a.start_at < b.start_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type SkeletonResult =
  ({ ok: true } & Pick<EnginePlan, "days">) | Extract<EngineGenerateResult, { ok: false }>;

function infeasible(reason: string, change: string): Extract<SkeletonResult, { ok: false }> {
  return { ok: false, infeasible: { feasible: false, reason, required_changes: [change] } };
}

function item(
  fields: Pick<PlannedItem, "kind" | "title" | "start_at" | "end_at"> & Partial<PlannedItem>,
): PlannedItem {
  return {
    id: "",
    location_id: null,
    task_id: null,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: true,
    status: "planned",
    reason_code: null,
    reason: null,
    ...fields,
  };
}

// 入力はcommon.mdの日時契約（+09:00付きISO）。同時刻は元のidで決める。
function byStartAndId(a: PlannedItem, b: PlannedItem): number {
  if (a.start_at !== b.start_at) return a.start_at < b.start_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * planning.md 10.4・P11: 今週の睡眠・固定予定・移動だけを作る。
 * fixed_eventsは展開済み。nowで切らず、locked_itemsの取り込みもここでは行わない。
 * style=nullでは内部名sharedを使う（17.2）。案別出力では10.2に従いIDを付け直す。
 */
export function buildSkeleton(context: PlanningContext): SkeletonResult {
  const days: EnginePlan["days"] = [];
  const home = context.home_location_id;
  const locations = new Map(context.locations.map((location) => [location.id, location]));
  if (!locations.has(home)) {
    return infeasible("自宅の場所が登録されていません。", "自宅の場所を登録する");
  }

  const { sleep_start, sleep_end } = context.preferences;
  if (sleep_start === sleep_end) {
    return infeasible("睡眠の開始と終了が同じ時刻です。", "睡眠の開始・終了時刻を確認する");
  }

  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(context.week_start, offset);
    const dayStart = atJstTime(date, "00:00");
    const dayEnd = atJstTime(date, "24:00");
    const sleepStart = atJstTime(date, sleep_start);
    const sleepEnd = atJstTime(date, sleep_end);
    const sleepRanges =
      sleepStart < sleepEnd
        ? [[sleepStart, sleepEnd]]
        : [
            [dayStart, sleepEnd],
            [sleepStart, dayEnd],
          ];
    const anchors: PlannedItem[] = sleepRanges
      .filter(([start, end]) => start < end)
      .map(([start_at, end_at], index) =>
        item({
          id: `sleep_${index}`,
          kind: "sleep",
          title: "睡眠",
          start_at,
          end_at,
          location_id: home,
        }),
      );

    // recurrenceは見ない。固定予定の値と参照IDを保ち、新しい項目だけ作る。
    for (const event of context.fixed_events) {
      if (toDateStr(event.start_at) !== date) continue;
      anchors.push(
        item({
          id: event.id,
          kind: "fixed",
          title: event.title,
          start_at: event.start_at,
          end_at: event.end_at,
          location_id: event.location_id,
          fixed_event_id: event.id,
          fixed_category: event.category,
        }),
      );
    }
    anchors.sort(byStartAndId);

    // 骨組み自体が成立するかの検査。タスク等を検査するValidatorは別工程。
    for (let index = 0; index < anchors.length; index++) {
      const current = anchors[index];
      if (current.start_at >= current.end_at) {
        return infeasible(
          `${current.title}の開始が終了より前になっていません。`,
          "開始・終了時刻を確認する",
        );
      }
      if (current.start_at < dayStart || current.end_at > dayEnd) {
        return infeasible(
          `${current.title}が${date}の0:00〜24:00に収まりません。`,
          "固定予定の日付・時刻を確認する",
        );
      }
      const previous = anchors[index - 1];
      if (previous && previous.end_at > current.start_at) {
        return infeasible(
          `${previous.title}と${current.title}が重なっています。`,
          "固定予定と睡眠の時刻を確認する",
        );
      }
    }

    const items = [...anchors];
    let from = home;
    let previousEnd = dayStart;
    let previousTitle = "日付の開始";
    // 睡眠は自宅の滞在として扱う。末尾の境界は帰宅を確認するためだけのもので、出力しない。
    const stops = [
      ...anchors,
      {
        title: "日付の終了",
        start_at: dayEnd,
        end_at: dayEnd,
        location_id: home,
      },
    ];
    for (const next of stops) {
      // backend.md 9.1.3: 場所不明の予定は直前の場所にいる。出力のnullは保持する。
      const to = next.location_id ?? from;
      if (!locations.has(to)) {
        return infeasible(
          `${next.title}の場所（${to}）が登録されていません。`,
          "固定予定の場所を確認する",
        );
      }
      if (from !== to) {
        const fromName = locations.get(from)!.name;
        const toName = locations.get(to)!.name;
        const route = context.travel_times.find(
          (entry) => entry.from_location_id === from && entry.to_location_id === to,
        );
        if (!route) {
          return infeasible(
            `移動時間表に『${fromName}→${toName}』を登録してください。`,
            `『${fromName}→${toName}』の移動時間を登録する`,
          );
        }
        // 自宅発は次の予定の直前。それ以外は直前の予定の直後。丸めも余裕の追加もしない。
        const start_at = from === home ? addMinutes(next.start_at, -route.minutes) : previousEnd;
        const end_at = addMinutes(start_at, route.minutes);
        if (start_at < previousEnd || end_at > next.start_at) {
          return infeasible(
            `${previousTitle}と${next.title}の間の移動時間が足りません（${fromName}→${toName}、${route.minutes}分）。`,
            "予定の時刻を調整し、移動時間を確保する",
          );
        }
        items.push(
          item({
            kind: "travel",
            title: `移動 ${fromName}→${toName}`,
            start_at,
            end_at,
            travel: { from_location_id: from, to_location_id: to, mode: route.mode },
          }),
        );
      }
      from = to;
      previousEnd = next.end_at;
      previousTitle = next.title;
    }

    items.sort(byStartAndId);
    days.push({
      date,
      items: items.map((entry, index) => ({
        ...entry,
        id: `tmp_${context.style ?? "shared"}_${date}_${index + 1}`,
      })),
    });
  }
  return { ok: true, days };
}
