"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, MessageCircle } from "lucide-react";
import { SEGMENT_LIST_STANDALONE, SEGMENT_TRIGGER } from "@/components/common/segment";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { Button } from "@/components/ui/button";
import { saveCheckin } from "@/lib/api";
import { consultTextFor, type CheckinLevels } from "@/lib/checkin";
import { CHECKIN_LABELS } from "@/lib/labels";
import type { Level } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type Field = keyof CheckinLevels;

const FIELDS: Field[] = ["mood", "fatigue", "concentration"];
const LEVELS: Level[] = ["low", "medium", "high"];

type CheckinCardProps = {
  /** 今日の日付（YYYY-MM-DD） */
  date: string;
  /** GET /api/checkin の値（未入力なら null） */
  initial: CheckinLevels | null;
  /** 今日に計画があり、now 以降に未完了のタスク枠があるか（「AIに相談する」を出す条件） */
  canConsult: boolean;
};

/**
 * /today の「今日の調子」（frontend.md 14.2）。気分・疲労・集中を3択で選び、押したらすぐ POST /api/checkin に送る。
 * チェックインを変えても計画は自動では作り直さない（FR-08-14）。調子が悪い側のときだけ「AIに相談する」を出し、
 * 押されたら /replan?text= に移る（計画を変えるのは /replan で「この計画にする」を押したときだけ）。
 */
export function CheckinCard({ date, initial, canConsult }: CheckinCardProps) {
  const router = useRouter();
  const [levels, setLevels] = useState<CheckinLevels>(
    initial ?? { mood: null, fatigue: null, concentration: null },
  );
  const [pending, setPending] = useState<Partial<Record<Field, boolean>>>({});
  const [failed, setFailed] = useState(false);

  async function change(field: Field, value: Level) {
    if (pending[field] || levels[field] === value) return;
    const previous = levels[field];
    // 先に表示を変え、失敗したら元に戻す
    setLevels((current) => ({ ...current, [field]: value }));
    setPending((current) => ({ ...current, [field]: true }));
    setFailed(false);
    try {
      // 部分更新なので、変えた項目だけ送る
      await saveCheckin({ date, [field]: value });
    } catch {
      setLevels((current) => (current[field] === value ? { ...current, [field]: previous } : current));
      setFailed(true);
    } finally {
      setPending((current) => ({ ...current, [field]: false }));
    }
  }

  const consultText = canConsult ? consultTextFor(levels) : null;

  return (
    <SurfaceCard className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{CHECKIN_LABELS.title}</h2>

      {FIELDS.map((field) => {
        const { label, options } = CHECKIN_LABELS.fields[field];
        const labelId = `checkin-${field}-label`;
        return (
          <div key={field} className="flex flex-col gap-1">
            <p id={labelId} className="text-sm text-muted-foreground">
              {label}
            </p>
            <div role="group" aria-labelledby={labelId} className={SEGMENT_LIST_STANDALONE}>
              {LEVELS.map((level) => {
                const active = levels[field] === level;
                return (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={active}
                    data-active={active ? "" : undefined}
                    disabled={pending[field]}
                    onClick={() => change(field, level)}
                    className={cn(SEGMENT_TRIGGER, "flex-1 px-1 whitespace-nowrap disabled:opacity-60")}
                  >
                    {options[level]}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {failed ? (
        <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <CircleAlert size={16} aria-hidden />
          {CHECKIN_LABELS.saveError}
        </p>
      ) : null}

      {consultText ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-[var(--brand-purple-pale)] p-3">
          <p className="text-sm font-medium">{CHECKIN_LABELS.consultPrompt}</p>
          <Button
            variant="brand-outline"
            size="tap"
            className="self-start"
            onClick={() => router.push(`/replan?text=${encodeURIComponent(consultText)}`)}
          >
            <MessageCircle aria-hidden />
            {CHECKIN_LABELS.consult}
          </Button>
        </div>
      ) : null}
    </SurfaceCard>
  );
}
