"use client";

import { BEAM_WEIGHT_LABELS, OBJECTIVE_AXES, STYLE_LABELS, STYLE_ORDER, type TurnView } from "@/lib/engine-view/view-state";
import type { PlanStyle } from "@/lib/schemas";
import { STYLE_COLORS } from "./colors";
import { isMoved } from "./motion";
import { AnimatedNumber, Bar, Delta, Panel } from "./parts";

// ② 3方向の目標（D_k）と今日のビームの重み（w_k）。疲れ high・集中 low で動く（P9.1）

type Values = Record<PlanStyle, number>;

function Header() {
  return (
    <>
      <span />
      {STYLE_ORDER.map((style) => (
        <span key={style} className="font-bold" style={{ color: STYLE_COLORS[style].text }}>
          {STYLE_LABELS[style]}
        </span>
      ))}
    </>
  );
}

// D_k：7成分すべて。数字と差分の下に細い棒
function DirectionGrid({ turn }: { turn: TurnView }) {
  const { directions } = turn.snapshot;
  return (
    <div className="grid grid-cols-[6.2em_1fr_1fr_1fr] items-center gap-x-2 gap-y-1">
      <Header />
      {OBJECTIVE_AXES.map(({ key, label }) => (
        <div key={key} className="contents">
          <span className="truncate">{label}</span>
          {STYLE_ORDER.map((style) => (
            <div key={style} className="flex flex-col">
              <div className="flex items-baseline justify-between gap-1 leading-5">
                <AnimatedNumber value={directions[style][key]} />
                <Delta value={directions[style][key]} resetKey={turn.turnId} compact />
              </div>
              <Bar value={directions[style][key]} color={STYLE_COLORS[style].line} className="h-1" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// w_k：このターンで変わった行だけ「今の値 ↑差分（ターンの始まりとの差）」で出し、残りは1行にまとめる
function WeightRows({ turn }: { turn: TurnView }) {
  const start = turn.startSnapshot.beam_weights;
  const now = turn.snapshot.beam_weights;
  const pick = (weights: Record<PlanStyle, number[]>, i: number): Values => ({
    intensive: weights.intensive[i] ?? 0,
    balanced: weights.balanced[i] ?? 0,
    relaxed: weights.relaxed[i] ?? 0,
  });
  const rows = BEAM_WEIGHT_LABELS.map((label, i) => ({ label, from: pick(start, i), to: pick(now, i) }));
  const changed = rows.filter((row) => STYLE_ORDER.some((style) => isMoved(row.from[style], row.to[style])));
  return (
    <div className="flex flex-col gap-1">
      {changed.length > 0 ? (
        <div className="grid grid-cols-[6.2em_1fr_1fr_1fr] items-baseline gap-x-2 gap-y-1">
          <Header />
          {changed.map((row) => (
            <div key={row.label} className="contents">
              <span className="truncate">{row.label}</span>
              {STYLE_ORDER.map((style) => (
                <span key={style} className="animate-in fade-in flex items-baseline justify-between gap-1 tabular-nums duration-500">
                  <AnimatedNumber value={row.to[style]} className="font-bold" />
                  <Delta value={row.to[style]} base={row.from[style]} resetKey={turn.turnId} compact />
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {changed.length < rows.length ? (
        <span className="text-muted-foreground">{changed.length === 0 ? "重みは変化なし" : "ほかの重みは変化なし"}</span>
      ) : null}
    </div>
  );
}

export function DirectionPanel({ turn }: { turn: TurnView }) {
  return (
    <Panel title="② 3方向の目標（D_k）" className="gap-2">
      <DirectionGrid turn={turn} />
      <h3 className="mt-1 text-lg font-bold">今日のビームの重み（w_k）</h3>
      <WeightRows turn={turn} />
    </Panel>
  );
}
