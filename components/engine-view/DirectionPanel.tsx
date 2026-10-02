"use client";

import { BEAM_WEIGHT_LABELS, OBJECTIVE_AXES, STYLE_LABELS, STYLE_ORDER, type TurnView } from "@/lib/engine-view/view-state";
import type { PlanStyle } from "@/lib/schemas";
import { STYLE_COLORS } from "./colors";
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

// 状態で動く w_k の成分（P9.1：w2 適合・w3 締切の安全・w5 空き時間・w6 詰め込み）。待機中も含めて常に出す
const STATE_WEIGHT_INDEXES = [1, 2, 4, 5] as const;

// w_k：状態で動く4行。差分はこのターンの始まりの値との差（新しいターンでは消え、state_update で付く）
function WeightRows({ turn }: { turn: TurnView }) {
  const pick = (weights: Record<PlanStyle, number[]>, i: number): Values => ({
    intensive: weights.intensive[i] ?? 0,
    balanced: weights.balanced[i] ?? 0,
    relaxed: weights.relaxed[i] ?? 0,
  });
  return (
    <div className="grid grid-cols-[6.2em_1fr_1fr_1fr] items-baseline gap-x-2 gap-y-1">
      <Header />
      {STATE_WEIGHT_INDEXES.map((i) => {
        const from = pick(turn.startSnapshot.beam_weights, i);
        const to = pick(turn.snapshot.beam_weights, i);
        return (
          <div key={i} className="contents">
            <span className="truncate">{BEAM_WEIGHT_LABELS[i]}</span>
            {STYLE_ORDER.map((style) => (
              <span key={style} className="flex items-baseline justify-between gap-1 tabular-nums">
                <AnimatedNumber value={to[style]} />
                <Delta value={to[style]} base={from[style]} resetKey={turn.turnId} compact />
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function DirectionPanel({ turn }: { turn: TurnView }) {
  return (
    <Panel title="② 3方向の目標（D_k）" className="gap-2">
      <DirectionGrid turn={turn} />
      <h3 className="text-lg font-bold">今日のビームの重み（w_k）</h3>
      <WeightRows turn={turn} />
    </Panel>
  );
}
