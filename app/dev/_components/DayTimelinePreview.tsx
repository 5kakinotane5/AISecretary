"use client";

import { ErrorState } from "@/components/common/ErrorState";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { Timeline } from "@/components/timeline/Timeline";
import { useApiData } from "@/hooks/use-api-data";
import { fetchCalendarDay, fetchTasks } from "@/lib/api";

type DayTimelinePreviewProps = {
  date: string;
  now?: string | null;
  /** 先頭から何件だけ表示するか（省略時はすべて） */
  maxItems?: number;
  /** 完了・ロックの見た目（mock-spec.md 1.3）の見本も出すか。データ自体は変えない */
  showStatusSample?: boolean;
};

/**
 * /dev/timeline・/dev/design 用：GET /api/calendar/day と GET /api/tasks から取得して Timeline を表示する。
 * 画面から mocks/ を直接 import しない（AGENTS.md「モックとの関係」）ため、確認用ページも API 経由にする。
 */
export function DayTimelinePreview({ date, now = null, maxItems, showStatusSample = false }: DayTimelinePreviewProps) {
  const result = useApiData(() => Promise.all([fetchCalendarDay(date), fetchTasks()]), [date], {
    isEmpty: ([day]) => !day.has_plan,
  });

  if (result.status === "loading") return <LoadingState rows={5} />;
  if (result.status === "error") return <ErrorState onRetry={result.retry} />;
  if (result.status === "empty") return <EmptyState message="この日の計画はまだありません" />;

  const [day, tasks] = result.data;

  const items = maxItems ? day.items.slice(0, maxItems) : day.items;
  const firstTask = day.items.find((item) => item.kind === "task");
  const firstBuffer = day.items.find((item) => item.kind === "buffer");
  const statusSample = [
    ...(firstTask ? [{ ...firstTask, status: "completed" as const }] : []),
    ...(firstBuffer ? [{ ...firstBuffer, locked: true }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <Timeline items={items} now={now} tasks={tasks} />
      {showStatusSample ? (
        <div>
          <p className="mb-2 text-sm font-bold">見本：完了（上）とロック（下）</p>
          <Timeline items={statusSample} tasks={tasks} />
        </div>
      ) : null}
    </div>
  );
}
