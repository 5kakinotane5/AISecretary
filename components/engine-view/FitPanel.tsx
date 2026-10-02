"use client";

import type { FitRow } from "@/lib/engine-view/events";
import type { TurnView } from "@/lib/engine-view/view-state";
import { formatTimeRange } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { AnimatedNumber, Bar, Delta, DOWN_COLOR, Panel } from "./parts";

// ③ 今日のタスクの適合度（Fit。P4）。gate が 0 の行は薄くして「外す」を付ける

const FEATURES: { key: keyof FitRow; label: string; english: string }[] = [
  { key: "duration_fit", label: "長さ", english: "DurationFit" },
  { key: "time_of_day_fit", label: "時間帯", english: "TimeOfDayFit" },
  { key: "concentration_fit", label: "集中", english: "ConcentrationFit" },
  { key: "fatigue_fit", label: "疲れ", english: "FatigueFit" },
  { key: "interrupt_fit", label: "中断", english: "InterruptFit" },
  { key: "split_fit", label: "分割", english: "SplitFit" },
];

function Feature({ label, english, value, resetKey }: { label: string; english: string; value: number; resetKey: string }) {
  return (
    <div className="flex flex-col gap-0.5" title={english}>
      <div className="flex items-baseline gap-2">
        <span className="w-[3.2em] shrink-0">{label}</span>
        <AnimatedNumber value={value} />
        <Delta value={value} resetKey={resetKey} compact />
      </div>
      <Bar value={value} className="h-1.5" color={value === 0 ? DOWN_COLOR : "var(--brand-purple)"} />
    </div>
  );
}

function TaskFit({ row, resetKey }: { row: FitRow; resetKey: string }) {
  const closed = row.gate === 0;
  return (
    <li className={cn("relative rounded-2xl border p-3", closed && "border-[var(--deadline-fg)]")}>
      {/* 行全体を薄くする。「外す」の札は薄くしない */}
      <div className={cn("flex flex-col gap-2 transition-opacity duration-700", closed && "opacity-45")}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-bold">{row.title}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{formatTimeRange(row.start_at, row.end_at)}</span>
        {row.high_concentration ? (
          <span className="shrink-0 rounded-md bg-[var(--kind-task-bg)] px-1.5 text-[var(--deadline-fg)]">高集中</span>
        ) : null}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-x-4 gap-y-1.5">
        {FEATURES.map(({ key, label, english }) => (
          <Feature key={key} label={label} english={english} value={row[key] as number} resetKey={resetKey} />
        ))}
      </div>
      <div className="flex items-baseline gap-3 tabular-nums">
        <span>
          q <AnimatedNumber value={row.q} />
        </span>
        <span>gate {row.gate}</span>
        <span className="font-bold">
          Fit <AnimatedNumber value={row.fit} /> <Delta value={row.fit} resetKey={resetKey} compact />
        </span>
      </div>
      </div>
      {closed ? (
        <span
          key={`${resetKey}-closed`}
          className="animate-in fade-in zoom-in-75 duration-500 absolute right-3 bottom-3 rounded-md bg-[var(--deadline-fg)] px-2 font-bold text-white"
        >
          外す
        </span>
      ) : null}
    </li>
  );
}

export function FitPanel({ turn }: { turn: TurnView }) {
  const rows = turn.snapshot.today_fits;
  return (
    <Panel title="③ 今日のタスクの適合度（Fit）" className="min-h-0">
      {rows.length === 0 ? (
        <p className="text-muted-foreground">今日のこれからのタスクはありません（有効な計画がない日を含む）</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <TaskFit key={row.item_id} row={row} resetKey={turn.turnId} />
          ))}
        </ul>
      )}
      <p className="text-muted-foreground">Fit = gate × q。長さ・時間帯・集中・疲れのどれかが 0 なら gate が 0（置かない）</p>
    </Panel>
  );
}
