import Link from "next/link";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { BottomTabBar } from "@/components/layout/BottomTabBar";
import { MobileShell } from "@/components/layout/MobileShell";
import { SCREEN_LABELS } from "@/lib/labels";
import { formatDateLong, formatDemoNow } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { DayTimelinePreview } from "../_components/DayTimelinePreview";

// Timeline の確認用ページ（mock-spec.md 8章ステップ5）。本番の画面遷移には含めない。
// 月曜（10/5）の予定を GET /api/calendar/day から表示する（初期状態ではバランスプラン）。
// ?now=HH:MM で現在時刻を切り替えられる。?mock_error=1 でエラー表示を確認できる。

const DATE = "2026-10-05";
const NOW_CHOICES = ["07:00", "08:02", "08:30", "09:00", "10:35", "14:50", "18:00"] as const;

export default async function DevTimelinePage({ searchParams }: PageProps<"/dev/timeline">) {
  const { now: nowParam } = await searchParams;
  const nowTime = typeof nowParam === "string" && /^\d{2}:\d{2}$/.test(nowParam) ? nowParam : "09:00";
  const now = `${DATE}T${nowTime}:00+09:00`;

  return (
    <MobileShell bottom={<BottomTabBar />}>
      <header className="px-4 pt-6 pb-14 text-white" style={{ background: "var(--gradient-header)" }}>
        <p className="text-xs opacity-80">/dev/timeline（確認用）</p>
        <h1 className="mt-1 text-xl font-bold">{formatDateLong(DATE)}</h1>
        <p className="mt-1 text-sm opacity-90">{formatDemoNow(now)}</p>
      </header>

      <div className="-mt-10 flex flex-col gap-4 px-4 pb-6">
        <SurfaceCard>
          <h2 className="mb-3 text-base font-bold">{SCREEN_LABELS.today}</h2>
          <DayTimelinePreview date={DATE} now={now} showStatusSample />
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="text-sm font-bold">現在時刻の切り替え</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            07:00（睡眠中）と 08:02・10:35（予定の間の隙間）は「次の航路」、08:30・14:50（移動中）は移動の行が「現在地」
          </p>
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
      </div>
    </MobileShell>
  );
}
