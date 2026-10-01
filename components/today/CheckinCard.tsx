"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, MessageCircle } from "lucide-react";
import { SEGMENT_LIST_STANDALONE, SEGMENT_TRIGGER } from "@/components/common/segment";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { Button } from "@/components/ui/button";
import { saveCheckin } from "@/lib/api";
import { consultTextFor, isCheckinComplete, type CheckinLevels, type CompleteCheckinLevels } from "@/lib/checkin";
import { CHECKIN_LABELS } from "@/lib/labels";
import type { Level } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type Field = keyof CheckinLevels;

const FIELDS: Field[] = ["mood", "fatigue", "concentration"];
const LEVELS: Level[] = ["low", "medium", "high"];

type CheckinCardProps = {
  /** 今日の日付（YYYY-MM-DD） */
  date: string;
  /** GET /api/checkin の値（なければ null） */
  initial: CheckinLevels | null;
  /** 今日に計画があり、now 以降に未完了のタスク枠があるか（「AIに相談する」を出す条件） */
  canConsult: boolean;
};

/**
 * /today の「今日の調子」（frontend.md 14.2）。1日1回だけ入力する。
 * 3つとも入っていれば（確定済み）1行の表示、そうでなければ入力カードを出す。入力カードは3つ選んで「決定」したときだけ
 * POST /api/checkin に送る。ロックは画面側だけ（/replan の state_change がサーバーで fatigue を書き換えるため、API は上書きできる）。
 * チェックインを入れても計画は自動では作り直さない（FR-08-14）。このページで「決定」した直後だけ、調子が悪い側なら
 * 「AIに相談する」を出し、押されたら /replan?text= に移る。
 */
export function CheckinCard({ date, initial, canConsult }: CheckinCardProps) {
  const [confirmed, setConfirmed] = useState<CompleteCheckinLevels | null>(
    isCheckinComplete(initial) ? initial : null,
  );
  // このページで「決定」した直後か（再読み込みしたら false に戻り、相談の一文は出さない）
  const [justDecided, setJustDecided] = useState(false);

  if (confirmed) {
    const consultText = justDecided && canConsult ? consultTextFor(confirmed) : null;
    return (
      <div className="flex flex-col gap-2">
        <CheckinSummary levels={confirmed} />
        {consultText ? <ConsultPrompt text={consultText} /> : null}
      </div>
    );
  }

  return (
    <CheckinForm
      date={date}
      initial={initial}
      onDecided={(levels) => {
        setConfirmed(levels);
        setJustDecided(true);
      }}
    />
  );
}

/** 確定後の1行表示。ボタンにしない（押しても何も起きない） */
function CheckinSummary({ levels }: { levels: CompleteCheckinLevels }) {
  return (
    <SurfaceCard className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-xs">
      <span className="font-bold">{CHECKIN_LABELS.title}</span>
      <span>
        {FIELDS.map((field) => {
          const { label, options } = CHECKIN_LABELS.fields[field];
          return `${label} ${options[levels[field]]}`;
        }).join("・")}
      </span>
    </SurfaceCard>
  );
}

function CheckinForm({
  date,
  initial,
  onDecided,
}: {
  date: string;
  initial: CheckinLevels | null;
  onDecided: (levels: CompleteCheckinLevels) => void;
}) {
  // 一部だけ入っている（/replan で fatigue だけ入った等）ときは、その値を初期選択にする
  const [levels, setLevels] = useState<CheckinLevels>({
    mood: initial?.mood ?? null,
    fatigue: initial?.fatigue ?? null,
    concentration: initial?.concentration ?? null,
  });
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = isCheckinComplete(levels);

  async function decide() {
    if (!isCheckinComplete(levels) || sending) return;
    setSending(true);
    setFailed(false);
    try {
      // 3つまとめて1回だけ送る
      const { checkin } = await saveCheckin({ date, ...levels });
      onDecided(isCheckinComplete(checkin) ? checkin : levels);
    } catch {
      // 選択は残す
      setFailed(true);
      setSending(false);
    }
  }

  return (
    <SurfaceCard className="flex flex-col gap-2 py-3">
      <h2 className="text-base font-bold">{CHECKIN_LABELS.inputTitle}</h2>

      {/* 行の見た目は40px。選択肢のタップ領域は上下の余白まで広げて44px（after: で上下6pxずつ。行の間4px＋内側の余白4px×2に収まる） */}
      <div className="flex flex-col gap-1">
        {FIELDS.map((field) => {
          const { label, options } = CHECKIN_LABELS.fields[field];
          const labelId = `checkin-${field}-label`;
          return (
            <div key={field} className="flex items-center gap-2">
              <span id={labelId} className="w-8 shrink-0 text-sm font-bold text-muted-foreground">
                {label}
              </span>
              <div role="group" aria-labelledby={labelId} className={cn(SEGMENT_LIST_STANDALONE, "h-10 min-w-0 flex-1")}>
                {LEVELS.map((level) => {
                  const active = levels[field] === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      aria-pressed={active}
                      data-active={active ? "" : undefined}
                      disabled={sending}
                      onClick={() => setLevels((current) => ({ ...current, [field]: level }))}
                      className={cn(
                        SEGMENT_TRIGGER,
                        "relative flex-1 px-1 text-xs whitespace-nowrap disabled:opacity-60",
                        "after:absolute after:inset-x-0 after:-inset-y-1.5",
                      )}
                    >
                      {options[level]}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {failed ? (
        <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <CircleAlert size={16} aria-hidden />
          {CHECKIN_LABELS.saveError}
        </p>
      ) : null}

      <Button size="tap" className="self-end px-8" disabled={!ready || sending} onClick={decide}>
        {CHECKIN_LABELS.submit}
      </Button>
    </SurfaceCard>
  );
}

/** 「今日の予定を軽くしますか？［AIに相談する］」。「決定」の直後だけ出す */
function ConsultPrompt({ text }: { text: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl bg-[var(--brand-purple-pale)] py-1 pr-1 pl-3">
      <p className="text-sm font-medium">{CHECKIN_LABELS.consultPrompt}</p>
      <Button
        variant="brand-outline"
        size="tap"
        className="shrink-0 px-3"
        onClick={() => router.push(`/replan?text=${encodeURIComponent(text)}`)}
      >
        <MessageCircle aria-hidden />
        {CHECKIN_LABELS.consult}
      </Button>
    </div>
  );
}
