import type { ComponentType } from "react";
import { Flame, Minus, Plus, Scale, Sprout, type LucideProps } from "lucide-react";
import { SuggestionCard } from "@/components/common/SuggestionCard";
import { Button } from "@/components/ui/button";
import { GOAL_PLAN_STYLE_LABELS, LOAD_LABELS, ONBOARDING_LABELS } from "@/lib/labels";
import type { GoalPlanStyle, GoalTimeCandidate } from "@/lib/schemas";

const STYLE_ICONS: Record<GoalPlanStyle, ComponentType<LucideProps>> = {
  intensive: Flame,
  balanced: Scale,
  paced: Sprout,
};

/** 「±0.5時間」の調整範囲（mock-spec.md 2.2・10.2） */
const MIN_HOURS = 1;
const MAX_HOURS = 15;
const STEP_HOURS = 0.5;

type GoalCandidateCardProps = {
  candidate: GoalTimeCandidate;
  /** 「これにする」で選ばれている案か。選ばれていると調整ボタンと「この内容で確定」を出す */
  chosen: boolean;
  /** 選ばれているときの週あたりの時間（調整後） */
  hours: number;
  onChoose: () => void;
  onHoursChange: (hours: number) => void;
  onConfirm: () => void;
  /** 送信中・送信後など、操作できないとき */
  disabled?: boolean;
};

/**
 * 目標時間3案のカード（mock-spec.md 2.2、design-spec.md 5.6・6章）。
 * 3枚を縦に同じ大きさで並べ、特定の案だけを目立たせない（どの案も同じ色・同じ形）。
 */
export function GoalCandidateCard({
  candidate,
  chosen,
  hours,
  onChoose,
  onHoursChange,
  onConfirm,
  disabled = false,
}: GoalCandidateCardProps) {
  const shownHours = chosen ? hours : candidate.hours_per_week;
  const details: { label: string; text: string }[] = [
    { label: "特徴", text: candidate.characteristics },
    { label: "メリット", text: candidate.merit },
    { label: "注意点", text: candidate.caution },
    { label: "理由", text: candidate.reason },
  ];

  return (
    <SuggestionCard
      icon={STYLE_ICONS[candidate.style]}
      title={GOAL_PLAN_STYLE_LABELS[candidate.style]}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <span
            className="rounded-xl px-2 py-0.5 font-medium"
            style={{ backgroundColor: "var(--brand-purple-pale)", color: "var(--deadline-fg)" }}
          >
            {LOAD_LABELS[candidate.expected_load]}
          </span>
          {candidate.period_weeks !== null ? <span>想定 {candidate.period_weeks}週間</span> : null}
        </span>
      }
      trailing={
        <p className="text-right">
          <span className="text-xs text-muted-foreground">週</span>
          <span className="ml-0.5 text-3xl font-bold tabular-nums">{shownHours}</span>
          <span className="ml-0.5 text-sm font-bold">時間</span>
        </p>
      }
      className={chosen ? "ring-2 ring-primary" : undefined}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        {details.map(({ label, text }) => (
          <div key={label} className="contents">
            <dt className="font-bold text-muted-foreground">{label}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>

      {chosen ? (
        <div className="flex flex-col gap-3 rounded-2xl p-3" style={{ backgroundColor: "var(--brand-purple-pale)" }}>
          <div className="flex items-center justify-between">
            <Button
              variant="brand-outline"
              size="tap"
              aria-label="0.5時間減らす"
              className="w-11 px-0"
              disabled={disabled || hours <= MIN_HOURS}
              onClick={() => onHoursChange(Math.max(MIN_HOURS, hours - STEP_HOURS))}
            >
              <Minus aria-hidden />
            </Button>
            <p className="text-base font-bold tabular-nums" aria-live="polite">
              週 {hours} 時間
            </p>
            <Button
              variant="brand-outline"
              size="tap"
              aria-label="0.5時間増やす"
              className="w-11 px-0"
              disabled={disabled || hours >= MAX_HOURS}
              onClick={() => onHoursChange(Math.min(MAX_HOURS, hours + STEP_HOURS))}
            >
              <Plus aria-hidden />
            </Button>
          </div>
          <Button size="tap" className="w-full" disabled={disabled} onClick={onConfirm}>
            {ONBOARDING_LABELS.confirmCandidate}
          </Button>
        </div>
      ) : (
        <Button variant="brand-outline" size="tap" className="w-full" disabled={disabled} onClick={onChoose}>
          {ONBOARDING_LABELS.chooseCandidate}
        </Button>
      )}
    </SuggestionCard>
  );
}
