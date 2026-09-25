import Link from "next/link";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { BottomTabBar } from "@/components/layout/BottomTabBar";
import { MobileShell } from "@/components/layout/MobileShell";
import { Timeline } from "@/components/timeline/Timeline";
import { SCREEN_LABELS } from "@/lib/labels";
import { formatDateLong, formatDemoNow } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { BALANCED_DAY_ITEMS } from "@/mocks/plans/balanced";
import { LOCATIONS } from "@/mocks/persona";
import { TASKS } from "@/mocks/tasks";

// Timeline の確認用ページ（mock-spec.md 8章ステップ5）。本番の画面遷移には含めない。
// 月曜（10/5）のバランスプランを表示する。?now=HH:MM で現在地の行を切り替えられる。

const DATE = "2026-10-05";
const NOW_CHOICES = ["07:00", "09:00", "13:30", "18:00", "21:30"] as const;

// 完了・ロックの見た目（mock-spec.md 1.3）を確かめるための見本。データ自体は変えない
const STATUS_SAMPLE = BALANCED_DAY_ITEMS[DATE].filter((item) => item.id === "bal_mon_1" || item.id === "bal_mon_2").map(
  (item, index) => (index === 0 ? { ...item, status: "completed" as const } : { ...item, locked: true }),
);

export default async function DevTimelinePage({ searchParams }: PageProps<"/dev/timeline">) {
  const { now: nowParam } = await searchParams;
  const nowTime = typeof nowParam === "string" && /^\d{2}:\d{2}$/.test(nowParam) ? nowParam : "09:00";
  const now = `${DATE}T${nowTime}:00+09:00`;

  return (
    <MobileShell withTabBar>
      <header className="px-4 pt-6 pb-14 text-white" style={{ background: "var(--gradient-header)" }}>
        <p className="text-xs opacity-80">/dev/timeline（確認用）</p>
        <h1 className="mt-1 text-xl font-bold">{formatDateLong(DATE)}</h1>
        <p className="mt-1 text-sm opacity-90">バランスの航路・{formatDemoNow(now)}</p>
      </header>

      <div className="-mt-10 flex flex-col gap-4 px-4 pb-6">
        <SurfaceCard>
          <h2 className="mb-3 text-base font-bold">{SCREEN_LABELS.today}</h2>
          <Timeline items={BALANCED_DAY_ITEMS[DATE]} now={now} tasks={TASKS} locations={LOCATIONS} />
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="text-sm font-bold">現在地の切り替え</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {NOW_CHOICES.map((time) => (
              <Link
                key={time}
                href={`/dev/timeline?now=${time}`}
                className={cn(
                  "flex h-11 items-center rounded-full border px-4 text-sm font-medium tabular-nums",
                  time === nowTime ? "border-primary bg-primary text-primary-foreground" : "bg-card text-primary",
                )}
              >
                {time}
              </Link>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="mb-3 text-sm font-bold">見本：完了（上）とロック（下）</h2>
          <Timeline items={STATUS_SAMPLE} tasks={TASKS} />
        </SurfaceCard>
      </div>

      <BottomTabBar />
    </MobileShell>
  );
}
