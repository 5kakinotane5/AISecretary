"use client";

import type { DirectionDistances } from "@/lib/engine-view/events";
import {
  nearestStyle,
  OBJECTIVE_AXES,
  STYLE_LABELS,
  STYLE_ORDER,
  type OptionView,
  type TurnView,
} from "@/lib/engine-view/view-state";
import type { ObjectiveVector, PlanStyle } from "@/lib/schemas";
import { BEFORE_COLOR, OPTION_COLORS, STYLE_COLORS } from "./colors";
import { useTweenArray } from "./motion";
import { AnimatedNumber, Delta, formatValue, Panel } from "./parts";

// ④ 計画の目的ベクトル（F(S)。P6）のレーダーと、方向との距離 d(S, D_k)（P8.2）・検査の結果

const SIZE = { width: 390, height: 245 };
const CENTER = { x: 210, y: 125 };
const RADIUS = 95;

const angle = (i: number) => (i * 2 * Math.PI) / OBJECTIVE_AXES.length - Math.PI / 2;
const point = (i: number, value: number) => {
  const r = RADIUS * Math.max(0, Math.min(1, value));
  return [CENTER.x + r * Math.cos(angle(i)), CENTER.y + r * Math.sin(angle(i))] as const;
};
const toValues = (vector: ObjectiveVector) => OBJECTIVE_AXES.map(({ key }) => vector[key]);

function Polygon({ vector, color, dashed = false, fill = 0 }: { vector: ObjectiveVector; color: string; dashed?: boolean; fill?: number }) {
  const values = useTweenArray(toValues(vector));
  const points = values.map((value, i) => point(i, value).join(",")).join(" ");
  return (
    <polygon
      points={points}
      fill={color}
      fillOpacity={fill}
      stroke={color}
      strokeWidth={dashed ? 1.5 : 2.5}
      strokeDasharray={dashed ? "5 4" : undefined}
      strokeOpacity={dashed ? 0.7 : 1}
    />
  );
}

function Radar({ turn, options }: { turn: TurnView; options: OptionView[] }) {
  return (
    <svg viewBox={`0 0 ${SIZE.width} ${SIZE.height}`} className="h-auto w-full max-w-[390px] self-center" role="img" aria-label="計画の目的ベクトルのレーダー">
      {[0.25, 0.5, 0.75, 1].map((level) => (
        <polygon
          key={level}
          points={OBJECTIVE_AXES.map((_, i) => point(i, level).join(",")).join(" ")}
          fill="none"
          stroke="var(--border)"
        />
      ))}
      {OBJECTIVE_AXES.map(({ key, label }, i) => {
        const [x, y] = point(i, 1);
        const [lx, ly] = [CENTER.x + (RADIUS + 14) * Math.cos(angle(i)), CENTER.y + (RADIUS + 14) * Math.sin(angle(i))];
        const anchor = Math.abs(lx - CENTER.x) < 8 ? "middle" : lx > CENTER.x ? "start" : "end";
        return (
          <g key={key}>
            <line x1={CENTER.x} y1={CENTER.y} x2={x} y2={y} stroke="var(--border)" />
            <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize={16} fill="var(--foreground)">
              {label}
            </text>
          </g>
        );
      })}
      {STYLE_ORDER.map((style) => (
        <Polygon key={style} vector={turn.snapshot.directions[style]} color={STYLE_COLORS[style].line} dashed />
      ))}
      {turn.beforeFeatures ? <Polygon vector={turn.beforeFeatures} color={BEFORE_COLOR} fill={0.18} /> : null}
      {options.map((option) =>
        option.features ? (
          <Polygon key={option.index} vector={option.features} color={OPTION_COLORS[(option.index - 1) % OPTION_COLORS.length]} fill={0.1} />
        ) : null,
      )}
    </svg>
  );
}

function Legend({ options }: { options: OptionView[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm" style={{ backgroundColor: BEFORE_COLOR }} />
        今の計画
      </span>
      {options.map((option) => (
        <span key={option.index} className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-sm" style={{ backgroundColor: OPTION_COLORS[(option.index - 1) % OPTION_COLORS.length] }} />
          案{option.index}
        </span>
      ))}
      {STYLE_ORDER.map((style) => (
        <span key={style} className="flex items-center gap-1.5" style={{ color: STYLE_COLORS[style].text }}>
          <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: STYLE_COLORS[style].line }} />
          {STYLE_LABELS[style]}
        </span>
      ))}
    </div>
  );
}

function Nearest({ distances }: { distances: DirectionDistances | null }) {
  const style = nearestStyle(distances);
  if (!style) return null;
  return (
    <span>
      一番近い：<b style={{ color: STYLE_COLORS[style].text }}>{STYLE_LABELS[style]}</b>
    </span>
  );
}

// 今の計画の距離。状態が変わったときは Before → After
function CurrentPlanDistances({ turn }: { turn: TurnView }) {
  const before = turn.beforeDistances;
  if (!before) return <p className="text-muted-foreground">今の計画の距離は計算できませんでした（有効な計画がない日など）</p>;
  const after = turn.afterDistances;
  const current = after ?? before;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="font-bold">今の計画</span>
        <Nearest distances={current} />
      </div>
      {STYLE_ORDER.map((style: PlanStyle) => (
        <div key={style} className="grid grid-cols-[5.5em_1fr] items-baseline gap-2 tabular-nums">
          <span style={{ color: STYLE_COLORS[style].text }}>{STYLE_LABELS[style]}</span>
          <span className="flex items-baseline gap-2">
            {after ? (
              <>
                <span className="text-muted-foreground">{formatValue(before[style])}</span>
                <span aria-hidden>→</span>
              </>
            ) : null}
            <AnimatedNumber value={current[style]} className="font-bold" />
            <Delta value={current[style]} resetKey={turn.turnId} compact />
          </span>
        </div>
      ))}
    </div>
  );
}

function OptionChecks({ turn }: { turn: TurnView }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-bold">検査の結果</span>
      {turn.options.length === 0 ? (
        <span className="text-muted-foreground">{turn.done ? "案はありません" : "案を待っています"}</span>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {turn.options.map((option) => (
            <li key={option.index} className="flex flex-col">
              <span className="flex items-baseline gap-2">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: OPTION_COLORS[(option.index - 1) % OPTION_COLORS.length] }}
                />
                <span className="min-w-0 flex-1 truncate">
                  案{option.index}「{option.label}」
                </span>
                <span className="shrink-0 font-bold">{option.ok ? `✔ 変更${option.changes}件` : "✕"}</span>
              </span>
              {option.ok ? (
                <span className="flex flex-wrap gap-x-3 pl-5 tabular-nums">
                  {STYLE_ORDER.map((style) => (
                    <span key={style} style={{ color: STYLE_COLORS[style].text }}>
                      {STYLE_LABELS[style]} {option.distances ? formatValue(option.distances[style]) : "—"}
                    </span>
                  ))}
                  <Nearest distances={option.distances} />
                </span>
              ) : (
                <span className="truncate pl-5 text-muted-foreground">{option.errors[0] ?? "通りませんでした"}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <span className="text-muted-foreground">
        やり直し {turn.retries} 回
        {turn.fallback ? (turn.fallback === "llm_off" ? "・AIを使わない経路" : "・AIの失敗でキーワードの経路") : ""}
      </span>
    </div>
  );
}

export function RadarPanel({ turn }: { turn: TurnView }) {
  const options = turn.options.filter((option) => option.ok && option.features);
  return (
    <Panel title="④ 計画の目的ベクトル（F(S)）">
      <Radar turn={turn} options={options} />
      <Legend options={options} />
      <h3 className="text-lg font-bold">方向との距離（d(S, D_k)）</h3>
      <CurrentPlanDistances turn={turn} />
      {turn.source === "replan" ? <OptionChecks turn={turn} /> : (
        <p className="text-muted-foreground">チェックインでは計画を作り直さないので、今の計画の F(S) は変わりません。D_k が動いた分だけ距離が変わります</p>
      )}
    </Panel>
  );
}
