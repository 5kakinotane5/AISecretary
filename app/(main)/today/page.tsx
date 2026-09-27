"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { FlashNotice } from "@/components/common/FlashNotice";
import { LoadingState } from "@/components/common/LoadingState";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { MainShell } from "@/components/layout/MainShell";
import { ItemDetailSheet } from "@/components/timeline/ItemDetailSheet";
import { Timeline } from "@/components/timeline/Timeline";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiData } from "@/hooks/use-api-data";
import { fetchCalendarDay, fetchClock, fetchSettings, fetchTasks } from "@/lib/api";
import { formatDateLong, toDateStr } from "@/lib/datetime";
import { SCREEN_LABELS, TODAY_LABELS, formatHours, getGreeting } from "@/lib/labels";
import { sumMinutesOfKind } from "@/lib/schedule";
import type { ScheduleItem } from "@/lib/schemas";

/** 「計画を更新しました」を出しておく時間 */
const NOTICE_MS = 3000;

/**
 * /today：今日の予定（mock-spec.md 2.4・10.7・10.12・10.20、design-spec.md 6章・9.4・9.8）。
 * GET /api/clock で現在時刻を読み、その日の計画を GET /api/calendar/day で取得する。
 * タスク（締切・候補）と場所（表示名）は GET /api/tasks・GET /api/settings から取る。
 */
export default function TodayPage() {
  const result = useApiData(
    async () => {
      const clock = await fetchClock();
      const now = clock.now;
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

  const data = result.status === "success" || result.status === "empty" ? result.data : null;
  const locationName = (id: string | null) =>
    id ? (data?.settings.locations.find((l) => l.id === id)?.name ?? null) : null;

  function handleItemSelect(item: ScheduleItem) {
    setSelected(item);
    setSheetOpen(true);
  }

  const bottom = (
    <div className="border-t border-border/70 bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(91,69,201,0.08)] backdrop-blur">
      <Link href="/replan" className={buttonVariants({ size: "cta", className: "rounded-full" })}>
        {SCREEN_LABELS.replanButton}
      </Link>
    </div>
  );
  const consultGoalButton = (
    <Link href="/interview" className={buttonVariants({ variant: "brand-outline", size: "tap" })}>
      {TODAY_LABELS.consultGoal}
    </Link>
  );

  return (
    <MainShell bottom={bottom}>
      {/* useSearchParams を使う部分は Suspense で囲む（Next.js の use-search-params.md「Prerendering」） */}
      <Suspense fallback={null}>
        <UpdatedNotice />
      </Suspense>

      <header className="px-5 pt-5 pb-12 text-white" style={{ background: "var(--gradient-header)" }}>
        {/* 読み込み中は挨拶と日付の位置にスケルトンを出し、カードの見出しと同じ「今日の予定」は出さない（10.21章） */}
        <div className="flex min-h-11 items-center justify-between gap-2">
          {data ? <p className="text-sm opacity-90">{getGreeting(data.now)}</p> : null}
          {result.status === "loading" ? <Skeleton className="h-4 w-52 rounded-full bg-white/20" /> : null}
        </div>
        {data ? <h1 className="mt-1 text-3xl font-bold tracking-tight">{formatDateLong(data.day.date)}</h1> : null}
        {result.status === "loading" ? <Skeleton className="h-8 w-40 rounded-full bg-white/20" /> : null}
        {data && result.status === "success" ? (
          <dl className="mt-4 flex flex-wrap gap-2 text-xs">
            <Total label={TODAY_LABELS.taskTotal} minutes={sumMinutesOfKind(data.day.items, "task")} />
            <Total label={TODAY_LABELS.bufferTotal} minutes={sumMinutesOfKind(data.day.items, "buffer")} />
            <Total label={TODAY_LABELS.freeTotal} minutes={sumMinutesOfKind(data.day.items, "free")} />
          </dl>
        ) : null}
      </header>

      {/* 白いカード「今日の予定」を上部に少し重ねる（design-spec.md 6章） */}
      <div className="-mt-8 px-3 pb-4">
        <SurfaceCard className="flex min-h-72 flex-col gap-4 rounded-[28px] p-5 shadow-[0_12px_36px_rgba(91,69,201,0.14)]">
          <h2 className="text-lg font-bold">{SCREEN_LABELS.today}</h2>

          {result.status === "loading" ? <LoadingState rows={6} /> : null}
          {result.status === "error" ? <ErrorState onRetry={result.retry} /> : null}
          {result.status === "empty" ? <EmptyState message={TODAY_LABELS.noPlan} action={consultGoalButton} /> : null}

          {result.status === "success" ? (
            <>
              {!result.data.day.has_plan ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {TODAY_LABELS.noPlan}。{TODAY_LABELS.noPlanHint}
                  </p>
                  {consultGoalButton}
                </>
              ) : null}
              <Timeline
                items={result.data.day.items}
                now={result.data.now}
                tasks={result.data.tasks}
                locations={result.data.settings.locations}
                onItemSelect={handleItemSelect}
              />
            </>
          ) : null}
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

function Total({ label, minutes }: { label: string; minutes: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/15 px-3 py-1.5 backdrop-blur-sm">
      <dt className="opacity-90">{label}</dt>
      <dd className="font-bold tabular-nums">{formatHours(minutes / 60)}</dd>
    </div>
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
