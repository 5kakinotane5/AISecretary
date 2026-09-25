"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { WeekConditionCard } from "@/components/calendar/WeekConditionCard";
import { WeekGrid } from "@/components/calendar/WeekGrid";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { SEGMENT_LIST, SEGMENT_TRIGGER } from "@/components/common/segment";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { MainShell } from "@/components/layout/MainShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { ItemDetailSheet } from "@/components/timeline/ItemDetailSheet";
import { Timeline } from "@/components/timeline/Timeline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiData } from "@/hooks/use-api-data";
import { fetchCalendarDay, fetchCalendarMonth, fetchCalendarWeek, fetchDemoNow, fetchSettings, fetchTasks } from "@/lib/api";
import {
  addDays,
  addMonths,
  formatDateLong,
  formatPeriod,
  formatYearMonth,
  getWeekStart,
  toDateStr,
  toMonthStr,
} from "@/lib/datetime";
import { CALENDAR_LABELS, CALENDAR_VIEW_LABELS, type CalendarViewMode } from "@/lib/labels";
import type { Location, ScheduleItem, Task } from "@/lib/schemas";

/** 月／週／日 の並び（初期表示は週。mock-spec.md 2.6） */
const VIEW_MODES: CalendarViewMode[] = ["month", "week", "day"];
const DEFAULT_MODE: CalendarViewMode = "week";

/**
 * /calendar：あなたの航海図（mock-spec.md 2.6、design-spec.md 6章・9.2）。
 * GET /api/mock/clock でデモ時刻を読み、その日を含む週から表示する。
 * 日表示のタイムライン・詳細シートに使うタスクと場所は GET /api/tasks・GET /api/settings から取る。
 * 週・日・月のデータは表示を切り替えるたびに GET /api/calendar/week・day・month で取る
 * （再計画の確定後は 10/5・10/7・10/8 が振り替え後の内容で返る。4.1章）。
 */
export default function CalendarPage() {
  const base = useApiData(async () => {
    const [now, tasks, settings] = await Promise.all([fetchDemoNow(), fetchTasks(), fetchSettings()]);
    return { now, tasks, locations: settings.locations };
  }, []);

  return (
    <MainShell>
      <PageHeader title={CALENDAR_LABELS.title} gradient="deep" />

      <div className="flex flex-col gap-4 px-4 py-4">
        {base.status === "loading" ? (
          <>
            <Skeleton className="h-12 w-full rounded-full" />
            <SurfaceCard>
              <LoadingState rows={6} />
            </SurfaceCard>
          </>
        ) : null}
        {base.status === "error" ? <ErrorState onRetry={base.retry} /> : null}
        {base.status === "success" ? (
          <CalendarBody now={base.data.now} tasks={base.data.tasks} locations={base.data.locations} />
        ) : null}
      </div>
    </MainShell>
  );
}

function CalendarBody({ now, tasks, locations }: { now: string; tasks: Task[]; locations: Location[] }) {
  const today = toDateStr(now);
  const [mode, setMode] = useState<CalendarViewMode>(DEFAULT_MODE);
  // 表示の基準日。週はこの日を含む週、月はこの日を含む月、日はこの日を表示する
  const [date, setDate] = useState(today);

  const weekStart = getWeekStart(date);
  const month = toMonthStr(date);
  const period =
    mode === "month"
      ? formatYearMonth(month)
      : mode === "week"
        ? formatPeriod(weekStart, addDays(weekStart, 6))
        : formatDateLong(date);

  function move(step: 1 | -1) {
    if (mode === "month") setDate(addMonths(date, step));
    else setDate(addDays(date, mode === "week" ? step * 7 : step));
  }

  /** 月表示の日付・週表示の列見出しをタップ → その日の日表示 */
  function openDay(target: string) {
    setDate(target);
    setMode("day");
  }

  return (
    <>
      <Tabs value={mode} onValueChange={(value) => setMode(value as CalendarViewMode)}>
        <TabsList aria-label="表示の切り替え" className={SEGMENT_LIST}>
          {VIEW_MODES.map((m) => (
            <TabsTrigger key={m} value={m} className={SEGMENT_TRIGGER}>
              {CALENDAR_VIEW_LABELS[m]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex items-center justify-between">
        <Button variant="brand-text" className="size-11 rounded-full" aria-label={CALENDAR_LABELS.prev[mode]} onClick={() => move(-1)}>
          <ChevronLeft className="size-6" aria-hidden />
        </Button>
        <p className="text-base font-bold tabular-nums" aria-live="polite">
          {period}
        </p>
        <Button variant="brand-text" className="size-11 rounded-full" aria-label={CALENDAR_LABELS.next[mode]} onClick={() => move(1)}>
          <ChevronRight className="size-6" aria-hidden />
        </Button>
      </div>

      {mode === "week" ? <WeekSection weekStart={weekStart} today={today} onDaySelect={openDay} /> : null}
      {mode === "day" ? <DaySection date={date} now={now} today={today} tasks={tasks} locations={locations} /> : null}
      {mode === "month" ? <MonthSection month={month} today={today} onDateSelect={openDay} /> : null}
    </>
  );
}

/** 週表示（mock-spec.md 2.6）。計画のない週は固定予定だけが返るので、その旨を添える */
function WeekSection({
  weekStart,
  today,
  onDaySelect,
}: {
  weekStart: string;
  today: string;
  onDaySelect: (date: string) => void;
}) {
  const result = useApiData(() => fetchCalendarWeek(weekStart), [weekStart], {
    isEmpty: (week) => week.days.every((day) => day.items.length === 0),
  });
  const hasPlan = result.status === "success" && result.data.days.some((day) => day.has_plan);

  return (
    <>
      <SurfaceCard className="flex flex-col gap-3 px-3">
        {result.status === "loading" ? <LoadingState rows={6} /> : null}
        {result.status === "error" ? <ErrorState onRetry={result.retry} /> : null}
        {result.status === "empty" ? <EmptyState message={CALENDAR_LABELS.noWeekData} /> : null}
        {result.status === "success" ? (
          <>
            {!hasPlan ? (
              <p className="px-1 text-sm text-muted-foreground">
                {CALENDAR_LABELS.noWeekPlan}。{CALENDAR_LABELS.noPlanHint}
              </p>
            ) : null}
            <WeekGrid days={result.data.days} today={today} onDaySelect={onDaySelect} />
          </>
        ) : null}
      </SurfaceCard>
      {result.status === "success" && hasPlan ? <WeekConditionCard days={result.data.days} /> : null}
    </>
  );
}

/** 日表示（mock-spec.md 2.6：/today と同じタイムライン部品）。タスク・余白をタップすると詳細シート */
function DaySection({
  date,
  now,
  today,
  tasks,
  locations,
}: {
  date: string;
  now: string;
  today: string;
  tasks: Task[];
  locations: Location[];
}) {
  const result = useApiData(() => fetchCalendarDay(date), [date], {
    isEmpty: (day) => day.items.length === 0,
  });
  const [selected, setSelected] = useState<ScheduleItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const locationName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? null) : null);

  function handleItemSelect(item: ScheduleItem) {
    setSelected(item);
    setSheetOpen(true);
  }

  return (
    <SurfaceCard className="flex flex-col gap-3">
      {result.status === "loading" ? <LoadingState rows={6} /> : null}
      {result.status === "error" ? <ErrorState onRetry={result.retry} /> : null}
      {result.status === "empty" ? <EmptyState message={CALENDAR_LABELS.noDayPlan} /> : null}
      {result.status === "success" ? (
        <>
          {!result.data.has_plan ? (
            <p className="text-sm text-muted-foreground">
              {CALENDAR_LABELS.noDayPlan}。{CALENDAR_LABELS.noPlanHint}
            </p>
          ) : null}
          <Timeline
            items={result.data.items}
            // 「現在地」「次の航路」の強調は今日だけ（ほかの日に出すと、その日の最初の予定が「次の航路」になるため）
            now={date === today ? now : null}
            tasks={tasks}
            locations={locations}
            onItemSelect={handleItemSelect}
          />
        </>
      ) : null}

      <ItemDetailSheet
        item={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        tasks={tasks}
        locationName={locationName(selected?.location_id ?? null)}
      />
    </SurfaceCard>
  );
}

/** 月表示（mock-spec.md 2.6）。2026年10月以外は days が空で返るので「この月のデータはありません」 */
function MonthSection({
  month,
  today,
  onDateSelect,
}: {
  month: string;
  today: string;
  onDateSelect: (date: string) => void;
}) {
  const result = useApiData(() => fetchCalendarMonth(month), [month], {
    isEmpty: (view) => view.days.length === 0,
  });

  return (
    <SurfaceCard className="px-3">
      {result.status === "loading" ? <LoadingState rows={5} /> : null}
      {result.status === "error" ? <ErrorState onRetry={result.retry} /> : null}
      {result.status === "empty" ? <EmptyState message={CALENDAR_LABELS.noMonthData} /> : null}
      {result.status === "success" ? (
        <MonthGrid days={result.data.days} today={today} onDateSelect={onDateSelect} />
      ) : null}
    </SurfaceCard>
  );
}
