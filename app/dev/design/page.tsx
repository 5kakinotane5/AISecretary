import type { ReactNode } from "react";
import { ArrowUp, Compass, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandImage } from "@/components/brand/BrandImage";
import { CompassMark } from "@/components/brand/CompassMark";
import { Logo } from "@/components/brand/Logo";
import {
  DEADLINE_BADGE_BG,
  DEADLINE_BADGE_TEXT_COLOR,
  formatDeadlineBadge,
  getItemAppearance,
  getTravelIcon,
} from "@/lib/labels";
import { diffMinutes, formatDateShort, formatTime } from "@/lib/datetime";
import type { ScheduleItem } from "@/lib/schemas";
import { BALANCED_DAY_ITEMS } from "@/mocks/plans/balanced";
import { TASKS } from "@/mocks/tasks";

// design-spec.md の値の確認用ページ。本番の画面遷移には含めない。

const TASK_DEADLINES = new Map(TASKS.map((t) => [t.id, t.deadline_at] as const));
const MONDAY_ITEMS = BALANCED_DAY_ITEMS["2026-10-05"].slice(0, 9);
const NOW_ITEM_ID = "fx_mon_lecture1"; // イメージの「9:00」に合わせて1限を現在地にする

export default function DevDesignPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--brand-bg)" }}>
      <div className="mx-auto flex max-w-[430px] flex-col gap-10 px-4 py-10">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--brand-dark)" }}>
            デザイン確認（/dev/design）
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--purple-gray)" }}>
            docs/design-spec.md の値を並べた確認用ページ。デモ操作の画面遷移には含まれない。
          </p>
        </div>

        <Section title="カラーパレット">
          <SwatchRow
            swatches={[
              { name: "brand-purple", varName: "--brand-purple" },
              { name: "brand-purple-light", varName: "--brand-purple-light" },
              { name: "brand-purple-pale", varName: "--brand-purple-pale" },
              { name: "brand-dark", varName: "--brand-dark" },
              { name: "brand-bg", varName: "--brand-bg" },
              { name: "surface", varName: "--surface" },
            ]}
          />
        </Section>

        <Section title="紫寄りの灰色">
          <SwatchRow
            swatches={[
              { name: "purple-gray", varName: "--purple-gray" },
              { name: "purple-gray-light", varName: "--purple-gray-light" },
            ]}
          />
        </Section>

        <Section title="予定の種類ごとの色">
          <SwatchRow
            swatches={[
              { name: "task", varName: "--kind-task" },
              { name: "task-bg", varName: "--kind-task-bg" },
              { name: "fixed", varName: "--kind-fixed" },
              { name: "fixed-bg", varName: "--kind-fixed-bg" },
              { name: "meal", varName: "--kind-meal" },
              { name: "meal-bg", varName: "--kind-meal-bg" },
              { name: "social", varName: "--kind-social" },
              { name: "social-bg", varName: "--kind-social-bg" },
              { name: "travel", varName: "--kind-travel" },
              { name: "buffer", varName: "--kind-buffer" },
              { name: "buffer-bg", varName: "--kind-buffer-bg" },
              { name: "free", varName: "--kind-free" },
              { name: "free-bg", varName: "--kind-free-bg" },
              { name: "sleep", varName: "--kind-sleep" },
            ]}
          />
        </Section>

        <Section title="主ボタン・副ボタン">
          <Card className="flex flex-col gap-3">
            <Button className="h-[52px] w-full rounded-full text-base font-bold">航路を調整する</Button>
            <Button
              variant="outline"
              className="h-[52px] w-full rounded-full border-[var(--brand-purple)] bg-white text-base font-bold text-[var(--brand-purple)] hover:bg-[var(--brand-purple-pale)]"
            >
              スケジュール作成
            </Button>
            <Button
              variant="ghost"
              className="h-auto w-fit self-center px-2 text-base font-medium text-[var(--brand-purple)] hover:bg-transparent hover:opacity-70"
            >
              テキストボタン
            </Button>
          </Card>
        </Section>

        <Section title="カードとタイムライン（月曜・バランスプラン）">
          <Card className="flex flex-col gap-0.5">
            <p className="mb-2 text-sm font-bold" style={{ color: "var(--brand-dark)" }}>
              今日の航路　{formatDateShort("2026-10-05")}
            </p>
            {MONDAY_ITEMS.map((item, index) => {
              const next = MONDAY_ITEMS[index + 1];
              return (
                <div key={item.id}>
                  <TimelineRow item={item} isNow={item.id === NOW_ITEM_ID} />
                  {next ? <Connector dashed={item.kind === "travel" || next.kind === "travel"} /> : null}
                </div>
              );
            })}
          </Card>
        </Section>

        <Section title="締切バッジ">
          <div
            className="inline-flex w-fit items-center gap-1 rounded-xl px-3 py-1.5 text-sm font-medium"
            style={{ backgroundColor: DEADLINE_BADGE_BG, color: DEADLINE_BADGE_TEXT_COLOR }}
          >
            <Flag size={16} />
            {formatDeadlineBadge(TASK_DEADLINES.get("task_report")!)}
          </div>
        </Section>

        <Section title="チャットの吹き出しと入力欄">
          <Card className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--brand-purple)" }}
              >
                <Compass size={16} className="text-white" />
              </span>
              <div
                className="max-w-[80%] rounded-[20px] rounded-bl-[6px] px-4 py-2.5 text-sm"
                style={{ backgroundColor: "var(--surface)", color: "var(--brand-dark)" }}
              >
                今日は疲れたのですね。無理せず、夜の予定を調整しましょうか。
              </div>
            </div>
            <div className="flex justify-end">
              <div
                className="max-w-[80%] rounded-[20px] rounded-br-[6px] px-4 py-2.5 text-sm"
                style={{ backgroundColor: "var(--brand-purple-pale)", color: "var(--brand-dark)" }}
              >
                今日は疲れた
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full px-4 py-2" style={{ backgroundColor: "var(--surface)" }}>
              <input
                className="min-w-0 flex-1 border-none bg-transparent text-base outline-none"
                style={{ color: "var(--brand-dark)" }}
                placeholder="何でも話してみてください…"
              />
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--brand-purple)" }}
              >
                <ArrowUp size={18} className="text-white" />
              </span>
            </div>
          </Card>
        </Section>

        <Section title="CompassMark とロゴ">
          <Card className="flex flex-col items-center gap-4">
            <CompassMark size={64} />
            <Logo size={32} />
          </Card>
        </Section>

        <Section title="グラデーション">
          <div className="flex flex-col gap-3">
            <GradientSwatch varName="--gradient-night" label="gradient-night（ログイン画面）" height={140} />
            <GradientSwatch varName="--gradient-header" label="gradient-header（ホーム上部）" height={88} />
            <GradientSwatch varName="--gradient-deep" label="gradient-deep（航海図・AIとの対話）" height={88} />
          </div>
        </Section>

        <Section title="BrandImage（画像未登録の代わりの表示）">
          <Card className="flex flex-col items-start gap-3">
            <p className="text-xs" style={{ color: "var(--purple-gray)" }}>
              lib/brand.ts はすべて null。画像を用意でき次第パスを登録すると、コード側を変えずに画像へ切り替わる。
            </p>
            <BrandImage
              imageKey="appIcon"
              alt="PURCHART アプリアイコン"
              width={64}
              height={64}
              fallback={
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-[24px]"
                  style={{ background: "var(--gradient-header)" }}
                >
                  <CompassMark size={32} />
                </div>
              }
            />
          </Card>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-bold" style={{ color: "var(--brand-dark)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`shadow-card rounded-[24px] p-4 ${className}`} style={{ backgroundColor: "var(--surface)" }}>
      {children}
    </div>
  );
}

function SwatchRow({ swatches }: { swatches: { name: string; varName: string }[] }) {
  return (
    <Card className="flex flex-wrap gap-3">
      {swatches.map((s) => (
        <div key={s.varName} className="flex w-16 flex-col items-center gap-1 text-center">
          <div
            className="h-12 w-12 rounded-2xl"
            style={{ backgroundColor: `var(${s.varName})`, border: "1px solid var(--purple-gray-light)" }}
          />
          <span className="text-[11px] font-medium" style={{ color: "var(--brand-dark)" }}>
            {s.name}
          </span>
          <span className="text-[9px]" style={{ color: "var(--purple-gray)" }}>
            {s.varName}
          </span>
        </div>
      ))}
    </Card>
  );
}

function GradientSwatch({ varName, label, height }: { varName: string; label: string; height: number }) {
  return (
    <div
      className="flex items-end rounded-[24px] p-4 text-xs font-medium text-white"
      style={{ background: `var(${varName})`, height }}
    >
      {label}
    </div>
  );
}

function Connector({ dashed }: { dashed: boolean }) {
  return (
    <div className="flex" style={{ height: 10 }}>
      <div style={{ width: 44 }} />
      <div className="flex justify-center" style={{ width: 24, marginLeft: 12, marginRight: 12 }}>
        <div
          className={dashed ? "h-full border-l border-dashed" : "h-full border-l"}
          style={{ borderColor: "var(--purple-gray-light)" }}
        />
      </div>
      <div className="flex-1" />
    </div>
  );
}

function TimelineRow({ item, isNow }: { item: ScheduleItem; isNow: boolean }) {
  const appearance = getItemAppearance(item.kind, item.fixed_category);

  if (item.kind === "sleep") {
    const Icon = appearance.icon;
    return (
      <RowShell>
        <div style={{ width: 24 }} className="flex shrink-0 items-center justify-center">
          <Icon size={14} style={{ color: appearance.iconColor }} />
        </div>
        <div className="flex-1 text-xs" style={{ color: "var(--purple-gray)" }}>
          睡眠 {formatTime(item.start_at)}–{formatTime(item.end_at)}
        </div>
      </RowShell>
    );
  }

  if (item.kind === "travel" && item.travel) {
    // getTravelIcon の戻り値をそのまま <Icon /> にすると react-hooks/static-components に
    // 引っかかるため、プロパティ経由で参照する
    const travelIcon = { Icon: getTravelIcon(item.travel.mode) };
    const minutes = diffMinutes(item.start_at, item.end_at);
    return (
      <RowShell>
        <div style={{ width: 24 }} className="flex shrink-0 items-center justify-center">
          <travelIcon.Icon size={14} style={{ color: "var(--kind-travel)" }} />
        </div>
        <div className="flex-1 text-xs" style={{ color: "var(--purple-gray)" }}>
          移動 {minutes}分
        </div>
      </RowShell>
    );
  }

  const Icon = appearance.icon;
  const deadline = item.task_id ? TASK_DEADLINES.get(item.task_id) : null;

  return (
    <RowShell timeSlot={<TimeLabel isoStr={item.start_at} isNow={isNow} />}>
      <div style={{ width: 24 }} className="flex shrink-0 items-center justify-center">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full"
          style={
            appearance.circleStyle === "filled"
              ? { backgroundColor: appearance.circleColor }
              : { border: `2px dashed ${appearance.circleColor}` }
          }
        >
          <Icon size={14} style={{ color: appearance.iconColor }} />
        </span>
      </div>
      <div
        className="min-w-0 flex-1 rounded-2xl px-3 py-2"
        style={{
          backgroundColor: appearance.blockBg,
          border: appearance.dashedBorder ? "1px dashed var(--purple-gray-light)" : undefined,
        }}
      >
        <p className="truncate text-sm font-bold" style={{ color: "var(--brand-dark)" }}>
          {item.title}
        </p>
        {deadline ? (
          <div
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-xl px-2 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: DEADLINE_BADGE_BG, color: DEADLINE_BADGE_TEXT_COLOR }}
          >
            <Flag size={12} />
            {formatDeadlineBadge(deadline)}
          </div>
        ) : null}
      </div>
    </RowShell>
  );
}

function RowShell({ timeSlot, children }: { timeSlot?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center" style={{ gap: 12 }}>
      <div style={{ width: 44 }} className="shrink-0 text-right">
        {timeSlot}
      </div>
      {children}
    </div>
  );
}

function TimeLabel({ isoStr, isNow }: { isoStr: string; isNow: boolean }) {
  if (isNow) {
    return (
      <span
        className="inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
        style={{ backgroundColor: "var(--brand-purple-pale)", color: "var(--brand-dark)" }}
      >
        {formatTime(isoStr)}
      </span>
    );
  }
  return (
    <span className="text-xs tabular-nums" style={{ color: "var(--purple-gray)" }}>
      {formatTime(isoStr)}
    </span>
  );
}
