"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { MobileShell } from "@/components/layout/MobileShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { PlanCompareTable } from "@/components/plans/PlanCompareTable";
import { Timeline } from "@/components/timeline/Timeline";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiData } from "@/hooks/use-api-data";
import { fetchPlanCandidates, fetchSettings, fetchTasks, selectPlan } from "@/lib/api";
import { addDays, formatPeriod, getWeekdayJa } from "@/lib/datetime";
import { ONBOARDING_LABELS, PLAN_STYLE_LABELS, PLAN_STYLE_SHORT_LABELS } from "@/lib/labels";
import type { PlanStyle } from "@/lib/schemas";

/** 初期表示はバランス（mock-spec.md 2.3） */
const DEFAULT_STYLE: PlanStyle = "balanced";

// 3案・曜日の切り替え（design-spec.md 6章：--brand-purple-pale の角丸のセグメント）
const SEGMENT_LIST = "w-full rounded-full bg-[var(--brand-purple-pale)] p-1 group-data-horizontal/tabs:h-12";
const SEGMENT_TRIGGER =
  "h-full min-w-0 rounded-full text-sm font-bold text-primary/70 hover:text-primary data-active:bg-card data-active:text-primary data-active:shadow-sm";

/**
 * /plans：航路プランを選ぶ（mock-spec.md 2.3・10.19、design-spec.md 6章）。
 * 画面を開いたら GET /api/plans/candidates で3案を取得する（generate の結果はブラウザに保存しない）。
 * 比較表の目標の行の見出しに使う目標名は GET /api/settings の goal から取る。
 * まだ生成していなければ空の表示と「航海の準備へ」を出す。戻るボタン・進行状況は出さない（10.19章）。
 */
export default function PlansPage() {
  const router = useRouter();
  const result = useApiData(() => Promise.all([fetchPlanCandidates(), fetchTasks(), fetchSettings()]), [], {
    // 3案をまだ生成していなければ { candidates: [] } が返る（10.19章）→ データなし
    isEmpty: ([candidates]) => candidates.length === 0,
  });
  const [style, setStyle] = useState<PlanStyle>(DEFAULT_STYLE);
  const [dayIndex, setDayIndex] = useState(0);
  const [selecting, setSelecting] = useState<"idle" | "loading" | "error">("idle");

  const [candidates, tasks, settings] = result.status === "success" ? result.data : [[], [], null];
  // 初期表示はバランス。万一その案がなければ先頭の案にする（データがあるのに何も出ない状態を作らない）
  const selected = candidates.find((c) => c.style === style) ?? candidates[0] ?? null;
  const weekStart = selected?.week_start ?? null;

  async function handleSelect() {
    if (!selected) return;
    setSelecting("loading");
    try {
      await selectPlan(selected.id);
      router.push("/today");
    } catch {
      setSelecting("error");
    }
  }

  const bottom = selected ? (
    <div className="flex flex-col gap-2 border-t bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {selecting === "error" ? (
        <ErrorState message="プランを選べませんでした。" onRetry={handleSelect} className="py-2" />
      ) : null}
      <Button size="cta" onClick={handleSelect} disabled={selecting === "loading"}>
        {ONBOARDING_LABELS.selectPlan}
      </Button>
    </div>
  ) : null;

  return (
    <MobileShell bottom={bottom}>
      <PageHeader
        title={ONBOARDING_LABELS.plansTitle}
        subtitle={weekStart ? formatPeriod(weekStart, addDays(weekStart, 6)) : undefined}
        gradient="header"
      />

      <div className="flex flex-col gap-4 px-4 py-4">
        {result.status === "loading" ? <LoadingState rows={5} /> : null}
        {result.status === "error" ? <ErrorState onRetry={result.retry} /> : null}
        {result.status === "empty" ? (
          <EmptyState
            message={ONBOARDING_LABELS.noPlans}
            action={
              <Link href="/interview" className={buttonVariants({ size: "tap" })}>
                {ONBOARDING_LABELS.backToInterview}
              </Link>
            }
          />
        ) : null}

        {selected && settings ? (
          <>
            <PlanCompareTable candidates={candidates} selectedId={selected.id} goalName={settings.goal.task_name} />

            <Tabs value={selected.style} onValueChange={(value) => setStyle(value as PlanStyle)}>
              <TabsList aria-label="航路プラン" className={SEGMENT_LIST}>
                {candidates.map((c) => (
                  <TabsTrigger key={c.id} value={c.style} className={SEGMENT_TRIGGER}>
                    {PLAN_STYLE_SHORT_LABELS[c.style]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <SurfaceCard className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-bold">{PLAN_STYLE_LABELS[selected.style]}</h2>
                <p className="mt-1 text-sm">{selected.summary.explanation}</p>
              </div>

              <Tabs value={dayIndex} onValueChange={(value) => setDayIndex(value as number)}>
                <TabsList aria-label="曜日" className={SEGMENT_LIST}>
                  {selected.days.map((day, index) => (
                    <TabsTrigger key={day.date} value={index} className={SEGMENT_TRIGGER}>
                      {getWeekdayJa(day.date)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <Timeline items={selected.days[dayIndex].items} tasks={tasks} />
            </SurfaceCard>
          </>
        ) : null}
      </div>
    </MobileShell>
  );
}
