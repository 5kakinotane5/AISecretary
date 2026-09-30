"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FlashNotice } from "@/components/common/FlashNotice";
import { LoadingState } from "@/components/common/LoadingState";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { DemoNowChip } from "@/components/layout/DemoNowChip";
import { MainShell } from "@/components/layout/MainShell";
import { ItemDetailSheet } from "@/components/timeline/ItemDetailSheet";
import { Timeline } from "@/components/timeline/Timeline";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiData } from "@/hooks/use-api-data";
import { fetchCalendarDay, fetchDemoNow, fetchSettings, fetchTasks, updatePlanItemCompletion } from "@/lib/api";
import { formatDateLong, toDateStr } from "@/lib/datetime";
import { SCREEN_LABELS, TODAY_LABELS } from "@/lib/labels";
import type { ScheduleItem } from "@/lib/schemas";

/** 「計画を更新しました」を出しておく時間 */
const NOTICE_MS = 3000;

/**
 * /today：今日の予定（mock-spec.md 2.4・10.7・10.12・10.20、design-spec.md 6章・9.4・9.8）。
 * GET /api/mock/clock でデモ時刻を読み、その日の計画を GET /api/calendar/day で取得する。
 * タスク（締切・候補）と場所（表示名）は GET /api/tasks・GET /api/settings から取る。
 */
export default function TodayPage() {
  const result = useApiData(
    async () => {
      const now = await fetchDemoNow();
      const [day, tasks, settings] = await Promise.all([
        fetchCalendarDay(toDateStr(now)),
        fetchTasks(),
        fetchSettings(),
      ]);
      return { now, day, tasks, settings };
    },
    [],
    // 固定予定もない日は「データなし」。計画がなく固定予定だけの日は、その旨を添えて表示する
    { isEmpty: ({ day }) => day.items.length === 0 },
  );
  const [selected, setSelected] = useState<ScheduleItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [taskStatusOverrides, setTaskStatusOverrides] = useState<Record<string, "planned" | "completed">>({});
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState(false);

  const data = result.status === "success" || result.status === "empty" ? result.data : null;
  const items = data?.day.items.map((item) => ({
    ...item,
    status: item.kind === "task" ? (taskStatusOverrides[item.id] ?? item.status) : item.status,
  })) ?? [];
  const taskItems = items.filter((item) => item.kind === "task");
  const completedTaskCount = taskItems.filter((item) => item.status === "completed").length;
  const completionPercent = taskItems.length === 0 ? 0 : Math.round((completedTaskCount / taskItems.length) * 100);
  const locationName = (id: string | null) =>
    id ? (data?.settings.locations.find((l) => l.id === id)?.name ?? null) : null;

  function handleItemSelect(item: ScheduleItem) {
    setSelected(item);
    setSheetOpen(true);
  }

  async function handleTaskCompletionChange(item: ScheduleItem, completed: boolean) {
    if (!data || pendingTaskId !== null) return;
    setPendingTaskId(item.id);
    setCompletionError(false);
    try {
      await updatePlanItemCompletion(item.id, data.day.date, completed);
      setTaskStatusOverrides((current) => ({ ...current, [item.id]: completed ? "completed" : "planned" }));
    } catch {
      setCompletionError(true);
    } finally {
      setPendingTaskId(null);
    }
  }

  return (
    <MainShell>
      {/* useSearchParams を使う部分は Suspense で囲む（Next.js の use-search-params.md「Prerendering」） */}
      <Suspense fallback={null}>
        <UpdatedNotice />
      </Suspense>

      {/* 高さは固定せず、中身（日付とチップの1行・達成率の1行）と上下12pxの余白で決める。セーフエリアの分は上に足す */}
      <header
        className="sticky top-0 z-20 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 text-white"
        style={{ background: "var(--gradient-header)" }}
      >
        {/* 読み込み中は日付の位置にスケルトンを出し、カードの見出しと同じ「今日の予定」は出さない（10.21章） */}
        <div className="flex min-h-9 items-center justify-between gap-2">
          {data ? <h1 className="text-2xl font-bold">{formatDateLong(data.day.date)}</h1> : null}
          {result.status === "loading" ? <Skeleton className="h-8 w-40 rounded-full bg-white/20" /> : null}
          {data ? <DemoNowChip now={data.now} /> : null}
        </div>
        {data ? (
          <div className="mt-1 flex min-h-7 items-center gap-2 text-sm" aria-live="polite">
            <span className="font-medium">{taskItems.length === 0 ? TODAY_LABELS.noTasks : TODAY_LABELS.achievement}</span>
            {taskItems.length > 0 ? (
              <span className="rounded-full bg-white/15 px-3 py-1 font-bold tabular-nums">
                {completionPercent}%　{completedTaskCount}/{taskItems.length}件
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="px-4 pt-3 pb-4">
        <SurfaceCard className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">{SCREEN_LABELS.today}</h2>

          {result.status === "loading" ? <LoadingState rows={6} /> : null}
          {result.status === "error" ? <ErrorState onRetry={result.retry} /> : null}
          {result.status === "empty" ? <EmptyState message={TODAY_LABELS.noPlan} /> : null}

          {result.status === "success" ? (
            <>
              {!result.data.day.has_plan ? (
                <p className="text-sm text-muted-foreground">
                  {TODAY_LABELS.noPlan}。{TODAY_LABELS.noPlanHint}
                </p>
              ) : null}
              <Timeline
                items={items}
                now={result.data.now}
                tasks={result.data.tasks}
                locations={result.data.settings.locations}
                onItemSelect={handleItemSelect}
                onTaskCompletionChange={handleTaskCompletionChange}
                pendingTaskId={pendingTaskId}
                autoScrollToHighlight
              />
            </>
          ) : null}
          {completionError ? <p role="alert" className="text-sm text-destructive">{TODAY_LABELS.completionError}</p> : null}
        </SurfaceCard>
      </div>

      <ItemDetailSheet
        item={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        tasks={data?.tasks}
        locationName={locationName(selected?.location_id ?? null)}
      />
    </MainShell>
  );
}

/**
 * 再計画の確定後（/today?updated=1）に「計画を更新しました」を1回だけ出し、
 * router.replace で /today に置き換えてクエリを消す（mock-spec.md 10.7・10.20）。
 */
function UpdatedNotice() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(() => searchParams.get("updated") === "1");

  useEffect(() => {
    if (!visible) return;
    router.replace("/today");
    const timer = setTimeout(() => setVisible(false), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [visible, router]);

  return <FlashNotice message={TODAY_LABELS.updated} visible={visible} />;
}
