"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, MapPin, RotateCcw } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { SEGMENT_LIST_STANDALONE, SEGMENT_TRIGGER } from "@/components/common/segment";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { DemoNowChip } from "@/components/layout/DemoNowChip";
import { MainShell } from "@/components/layout/MainShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import { fetchDemoNow, fetchSettings, resetMock, setDemoNow } from "@/lib/api";
import { formatDateLong, toDateStr } from "@/lib/datetime";
import {
  DEMO_CLOCK_TIMES,
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
 * デモ用の欄は GET・POST /api/mock/clock と POST /api/mock/reset を呼ぶ。
 */
export default function SettingsPage() {
  const settings = useApiData(fetchSettings, []);
  const clock = useApiData(fetchDemoNow, []);
  // デモ時刻を切り替えたあとの時刻（取り直さずに、POST の応答で表示を更新する）
  const [changedNow, setChangedNow] = useState<string | null>(null);
  const now = changedNow ?? (clock.status === "success" ? clock.data : null);

  return (
    <MainShell>
      <PageHeader
        title={SETTINGS_LABELS.title}
        gradient="header"
        trailing={now ? <DemoNowChip now={now} /> : null}
      />

      <div className="flex flex-col gap-4 px-4 py-4">
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

        <Section title={SETTINGS_LABELS.demoTitle}>
          {clock.status === "loading" && !now ? <LoadingState rows={1} /> : null}
          {clock.status === "error" && !now ? <ErrorState onRetry={clock.retry} /> : null}
          {now ? <DemoClockSwitch now={now} onChanged={setChangedNow} /> : null}
          <ResetButton />
        </Section>
      </div>
    </MainShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SurfaceCard className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </SurfaceCard>
  );
}

/** 表示だけの4つの欄（生活リズム・よく行く場所・移動時間・目的地） */
function SettingsSections({ data }: { data: SettingsResponse }) {
  const { preferences, locations, travel_times: travelTimes, goal } = data;
  // 場所の名前が引けないときは、推測で埋めずに id をそのまま出す
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

  return (
    <>
      <Section title={SETTINGS_LABELS.rhythmTitle}>
        <dl className="flex flex-col divide-y">
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

      <Section title={SETTINGS_LABELS.goalTitle}>
        {goal === null ? (
          <p className="text-sm text-muted-foreground">{SETTINGS_LABELS.noGoal}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-base font-bold">
              {goal.task_name}
              {goal.target_hours_per_week !== null ? (
                <span className="text-primary">
                  {"　"}
                  {formatHoursPerWeek(goal.target_hours_per_week)}
                </span>
              ) : null}
            </p>
            {goal.deadline ? (
              <p className="text-sm text-muted-foreground">
                {SETTINGS_LABELS.deadline} {formatDateLong(goal.deadline)}
              </p>
            ) : null}
            {goal.conditions.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {goal.conditions.map((condition) => (
                  <li key={condition} className="rounded-xl bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {condition}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        <Link href="/interview" className={cn(buttonVariants({ variant: "brand-outline", size: "cta" }))}>
          {SETTINGS_LABELS.consultGoal}
        </Link>
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

/** デモ時刻の切り替え（07:00 ／ 18:00）。今のデモ日付のまま、時刻だけを POST /api/mock/clock で変える */
function DemoClockSwitch({ now, onChanged }: { now: string; onChanged: (now: string) => void }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(time: string) {
    setPending(true);
    setFailed(false);
    try {
      onChanged(await setDemoNow(`${toDateStr(now)}T${time}:00+09:00`));
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground" id="demo-clock-label">
        {SETTINGS_LABELS.demoClock}
      </p>
      <div role="group" aria-labelledby="demo-clock-label" className={SEGMENT_LIST_STANDALONE}>
        {DEMO_CLOCK_TIMES.map((time) => {
          const active = now === `${toDateStr(now)}T${time}:00+09:00`;
          return (
            <button
              key={time}
              type="button"
              aria-pressed={active}
              data-active={active ? "" : undefined}
              disabled={pending}
              onClick={() => change(time)}
              className={cn(SEGMENT_TRIGGER, "flex-1 tabular-nums disabled:opacity-60")}
            >
              {time}
            </button>
          );
        })}
      </div>
      {failed ? <InlineError message={SETTINGS_LABELS.demoClockError} /> : null}
    </div>
  );
}

/** 「モックをリセット」：POST /api/mock/reset のあと /login に移動する */
function ResetButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function reset() {
    setPending(true);
    setFailed(false);
    try {
      await resetMock();
      router.push("/login");
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  // 確認なしで実行するため、副ボタンの見た目にし、画面の一番下に区切り線をはさんで置く（mock-spec.md 10.23）
  return (
    <div className="mt-1 flex flex-col gap-2 border-t pt-4">
      <Button variant="brand-outline" size="cta" disabled={pending} onClick={reset}>
        <RotateCcw aria-hidden />
        {pending ? SETTINGS_LABELS.resetting : SETTINGS_LABELS.reset}
      </Button>
      {failed ? <InlineError message={SETTINGS_LABELS.resetError} /> : null}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
      <CircleAlert size={16} aria-hidden />
      {message}
    </p>
  );
}
