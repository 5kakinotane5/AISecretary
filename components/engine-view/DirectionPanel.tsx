"use client";

import { BEAM_WEIGHT_LABELS, OBJECTIVE_AXES, STYLE_LABELS, STYLE_ORDER, type TurnView } from "@/lib/engine-view/view-state";
import { AnimatedNumber, Bar, Delta, Panel } from "./parts";
import { STYLE_COLORS } from "./colors";

// ② 3方向の目標（D_k）と今日のビームの重み（w_k）。疲れ high・集中 low で動く（P9.1）

function Cell({ value, resetKey, color }: { value: number; resetKey: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-1">
        <AnimatedNumber value={value} />
        <Delta value={value} resetKey={resetKey} compact />
      </div>
      <Bar value={value} color={color} className="h-1.5" />
    </div>
  );
}

function Grid({ rows, turnId }: { rows: { label: string; values: Record<(typeof STYLE_ORDER)[number], number> }[]; turnId: string }) {
  return (
    <div className="grid grid-cols-[6.2em_1fr_1fr_1fr] items-center gap-x-2 gap-y-1.5">
      <span />
      {STYLE_ORDER.map((style) => (
        <span key={style} className="font-bold" style={{ color: STYLE_COLORS[style].text }}>
          {STYLE_LABELS[style]}
        </span>
      ))}
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <span className="truncate">{row.label}</span>
          {STYLE_ORDER.map((style) => (
            <Cell key={style} value={row.values[style]} resetKey={turnId} color={STYLE_COLORS[style].line} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DirectionPanel({ turn }: { turn: TurnView }) {
  const { directions, beam_weights: weights } = turn.snapshot;
  const directionRows = OBJECTIVE_AXES.map(({ key, label }) => ({
    label,
    values: { intensive: directions.intensive[key], balanced: directions.balanced[key], relaxed: directions.relaxed[key] },
  }));
  const weightRows = BEAM_WEIGHT_LABELS.map((label, i) => ({
    label,
    values: { intensive: weights.intensive[i] ?? 0, balanced: weights.balanced[i] ?? 0, relaxed: weights.relaxed[i] ?? 0 },
  }));
  return (
    <Panel title="② 3方向の目標（D_k）">
      <Grid rows={directionRows} turnId={turn.turnId} />
      <h3 className="mt-1 text-lg font-bold">今日のビームの重み（w_k）</h3>
      <Grid rows={weightRows} turnId={turn.turnId} />
    </Panel>
  );
}
