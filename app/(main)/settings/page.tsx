"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { MapPin, Target } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { MainShell } from "@/components/layout/MainShell";
import { buttonVariants } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import { fetchSettings } from "@/lib/api";
import { formatDateLong } from "@/lib/datetime";
import {
  SETTINGS_LABELS,
  formatClockRange,
  formatHoursPerWeek,
  formatMinutes,
  formatRoute,
  formatTravelDuration,
  getTravelIcon,
} from "@/lib/labels";
import type { SettingsResponse } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * /settings：設定（mock-spec.md 2.7、design-spec.md 6章：白いカードに項目を並べる）。
 * 生活リズム・場所・移動時間・目標は GET /api/settings から取り、表示だけする。
 */
export default function SettingsPage() {
  const settings = useApiData(fetchSettings, []);

  return (
    <MainShell>
      <header
        className="min-h-[190px] px-5 pt-6 pb-16 text-white"
        style={{ background: "var(--gradient-header)" }}
      >
        <p className="text-xs font-semibold tracking-[0.18em] text-white/70">YOUR PLAN PROFILE</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">{SETTINGS_LABELS.title}</h1>
        <p className="mt-2 max-w-xs text-sm leading-6 text-white/80">暮らしに合わせて、予定づくりの土台を整えます</p>
      </header>

      <div className="relative z-10 -mt-10 flex flex-col gap-3 px-3 pb-4">
        {settings.status === "loading" ? (
          <SurfaceCard>
            <LoadingState rows={5} />
          </SurfaceCard>
        ) : null}
        {settings.status === "error" ? (
          <SurfaceCard>
            <ErrorState onRetry={settings.retry} />
          </SurfaceCard>
        ) : null}
        {settings.status === "success" ? <SettingsSections data={settings.data} /> : null}
      </div>
    </MainShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SurfaceCard className="flex flex-col gap-3 rounded-[28px] p-5">
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-primary" aria-hidden />
        <h2 className="text-base font-bold">{title}</h2>
      </div>
      {children}
    </SurfaceCard>
  );
}

/** 表示だけの4つの欄（生活リズム・よく行く場所・移動時間・目標） */
function SettingsSections({ data }: { data: SettingsResponse }) {
  const { preferences, locations, travel_times: travelTimes, goal } = data;
  // 場所の名前が引けないときは、推測で埋めずに id をそのまま出す
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

  return (
    <>
      <SurfaceCard className="flex flex-col gap-4 rounded-[28px] border border-primary/10 bg-[linear-gradient(145deg,var(--brand-purple-pale),var(--surface)_58%)] p-5 shadow-[0_14px_36px_rgba(91,69,201,0.16)]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-wide text-primary">{SETTINGS_LABELS.goalTitle}</p>
          <span className="flex size-10 items-center justify-center rounded-full bg-white/80 text-primary">
            <Target size={20} aria-hidden />
          </span>
        </div>
        {goal === null ? (
          <p className="text-sm text-muted-foreground">{SETTINGS_LABELS.noGoal}</p>
        ) : (
          <>
            <h2 className="text-2xl font-bold tracking-tight">{goal.task_name}</h2>
            <div className="flex flex-wrap gap-2">
              {goal.target_hours_per_week !== null ? (
                <span className="rounded-full bg-white/80 px-3 py-1.5 text-sm font-semibold text-primary">
                  {formatHoursPerWeek(goal.target_hours_per_week)}
                </span>
              ) : null}
              {goal.deadline ? (
                <span className="rounded-full bg-white/80 px-3 py-1.5 text-sm text-muted-foreground">
                  {SETTINGS_LABELS.deadline} {formatDateLong(goal.deadline)}
                </span>
              ) : null}
            </div>
            {goal.conditions.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {goal.conditions.map((condition) => (
                  <li key={condition} className="rounded-xl border border-primary/10 bg-white/60 px-2.5 py-1 text-xs text-muted-foreground">
                    {condition}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        <Link href="/interview?returnTo=settings" className={cn(buttonVariants({ variant: "brand-outline", size: "tap" }), "w-full rounded-full bg-white/80")}>
          {SETTINGS_LABELS.consultGoal}
        </Link>
      </SurfaceCard>

      <Section title={SETTINGS_LABELS.rhythmTitle}>
        <dl className="grid grid-cols-1 divide-y rounded-2xl bg-muted/50 px-3">
          <Row label={SETTINGS_LABELS.sleep} value={formatClockRange(preferences.sleep_start, preferences.sleep_end)} />
          <Row label={SETTINGS_LABELS.dailyWorkLimit} value={formatMinutes(preferences.daily_work_limit_minutes)} />
          <Row label={SETTINGS_LABELS.minBuffer} value={formatMinutes(preferences.min_buffer_minutes)} />
        </dl>
      </Section>

      <Section title={SETTINGS_LABELS.locationsTitle}>
        {locations.length === 0 ? (
          <EmptyState message={SETTINGS_LABELS.noLocations} className="py-4" />
        ) : (
          <ul className="flex flex-col divide-y">
            {locations.map((location) => (
              <li key={location.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                <MapPin size={18} className="mt-0.5 shrink-0 text-(--brand-purple-light)" aria-hidden />
                <div className="min-w-0">
                  <p className="font-bold">{location.name}</p>
                  <p className="text-xs text-muted-foreground">{location.address}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={SETTINGS_LABELS.travelTitle}>
        {travelTimes.length === 0 ? (
          <EmptyState message={SETTINGS_LABELS.noTravelTimes} className="py-4" />
        ) : (
          <ul className="flex flex-col divide-y">
            {travelTimes.map((travel) => {
              const Icon = getTravelIcon(travel.mode);
              return (
                <li
                  key={`${travel.from_location_id}-${travel.to_location_id}`}
                  className="flex gap-3 py-2.5 text-sm first:pt-0 last:pb-0"
                >
                  <Icon size={18} className="mt-0.5 shrink-0" style={{ color: "var(--kind-travel)" }} aria-hidden />
                  <p className="min-w-0">
                    {formatRoute(locationName(travel.from_location_id), locationName(travel.to_location_id))}
                    {"　"}
                    <span className="font-bold whitespace-nowrap tabular-nums">
                      {formatTravelDuration(travel.minutes, travel.mode)}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-bold tabular-nums">{value}</dd>
    </div>
  );
}
