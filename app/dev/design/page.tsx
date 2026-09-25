import type { ReactNode } from "react";
import { Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandImage } from "@/components/brand/BrandImage";
import { CompassMark } from "@/components/brand/CompassMark";
import { Logo } from "@/components/brand/Logo";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { SuggestionCard } from "@/components/common/SuggestionCard";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { ChatBubble, ChatTypingBubble } from "@/components/interview/ChatBubble";
import { DeadlineBadge } from "@/components/timeline/DeadlineBadge";
import { Timeline } from "@/components/timeline/Timeline";
import { formatDateShort } from "@/lib/datetime";
import { BALANCED_DAY_ITEMS } from "@/mocks/plans/balanced";
import { TASKS } from "@/mocks/tasks";
import { ChatInputSample, ErrorStateSample } from "./InteractiveSamples";

// design-spec.md の値の確認用ページ。本番の画面遷移には含めない。

const REPORT_DEADLINE = TASKS.find((t) => t.id === "task_report")?.deadline_at ?? null;
const MONDAY_ITEMS = BALANCED_DAY_ITEMS["2026-10-05"].slice(0, 9);
const DEMO_NOW = "2026-10-05T09:00:00+09:00"; // イメージの「9:00」に合わせて1限を現在地にする

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

        <Section title="主ボタン・副ボタン・テキストボタン">
          <SurfaceCard className="flex flex-col gap-3">
            <Button size="cta">航路を調整する</Button>
            <Button variant="brand-outline" size="cta">
              スケジュール作成
            </Button>
            <Button variant="brand-text" size="tap" className="self-center">
              テキストボタン
            </Button>
          </SurfaceCard>
        </Section>

        <Section title="カードとタイムライン（月曜・バランスプラン）">
          <SurfaceCard>
            <p className="mb-2 text-sm font-bold">今日の航路　{formatDateShort("2026-10-05")}</p>
            <Timeline items={MONDAY_ITEMS} now={DEMO_NOW} tasks={TASKS} />
          </SurfaceCard>
        </Section>

        <Section title="締切バッジ">
          {REPORT_DEADLINE ? <DeadlineBadge deadlineAt={REPORT_DEADLINE} size="md" /> : null}
        </Section>

        <Section title="チャットの吹き出しと入力欄">
          <SurfaceCard className="flex flex-col gap-3" style={{ backgroundColor: "var(--brand-bg)" }}>
            <ChatBubble role="assistant">今日は疲れたのですね。無理せず、夜の予定を調整しましょうか。</ChatBubble>
            <ChatBubble role="user">今日は疲れた</ChatBubble>
            <ChatTypingBubble />
            <ChatInputSample />
          </SurfaceCard>
        </Section>

        <Section title="おすすめ・候補カード">
          <SuggestionCard
            icon={Scale}
            title="バランス標準型"
            description="無理なく続けやすい、平日夜と週末に分ける案"
            trailing={<span className="text-xl font-bold tabular-nums">週6時間</span>}
          />
        </Section>

        <Section title="状態表示（ローディング・エラー・空）">
          <SurfaceCard className="flex flex-col gap-6">
            <LoadingState message="スケジュールを作成しています…" rows={3} />
            <ErrorStateSample />
            <EmptyState message="この日の計画はまだありません" />
          </SurfaceCard>
        </Section>

        <Section title="CompassMark とロゴ">
          <SurfaceCard className="flex flex-col items-center gap-4">
            <CompassMark size={64} />
            <Logo size={32} />
          </SurfaceCard>
        </Section>

        <Section title="グラデーション">
          <div className="flex flex-col gap-3">
            <GradientSwatch varName="--gradient-night" label="gradient-night（ログイン画面）" height={140} />
            <GradientSwatch varName="--gradient-header" label="gradient-header（ホーム上部）" height={88} />
            <GradientSwatch varName="--gradient-deep" label="gradient-deep（航海図・AIとの対話）" height={88} />
          </div>
        </Section>

        <Section title="BrandImage（画像未登録の代わりの表示）">
          <SurfaceCard className="flex flex-col items-start gap-3">
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
          </SurfaceCard>
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

function SwatchRow({ swatches }: { swatches: { name: string; varName: string }[] }) {
  return (
    <SurfaceCard className="flex flex-wrap gap-3">
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
    </SurfaceCard>
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
