"use client";

import { Check } from "lucide-react";
import { levelText, type TurnView } from "@/lib/engine-view/view-state";
import { CHECKIN_LABELS } from "@/lib/labels";
import type { Level } from "@/lib/schemas";
import { Panel, UP_COLOR } from "./parts";

// ① 把握している状態（s_t）。疲れ・集中は Engine が使う（P9.1・P4）。気分は値だけ出す（P2.1）

const FIELDS = [
  { field: "fatigue", label: "疲れ" },
  { field: "concentration", label: "集中" },
] as const;

const meaning = (field: "fatigue" | "concentration" | "mood", level: Level | null) =>
  level === null ? null : CHECKIN_LABELS.fields[field].options[level];

export function StatePanel({ turn }: { turn: TurnView }) {
  const { checkin } = turn.snapshot;
  return (
    <Panel title="① 把握している状態（s_t）">
      <ul className="flex flex-col gap-2">
        {FIELDS.map(({ field, label }) => {
          const from = turn.startSnapshot.checkin[field];
          const to = checkin[field];
          const changed = from !== to;
          return (
            <li key={field} className="flex items-baseline gap-3">
              <span className="w-10 shrink-0 font-bold">{label}</span>
              {changed ? (
                <span className="flex items-baseline gap-2">
                  <span className="text-muted-foreground">{levelText(from)}</span>
                  <span aria-hidden>→</span>
                  {/* key を変えて、値が入るたびに出てくる動きをやり直す */}
                  <span key={`${turn.turnId}-${to}`} className="animate-in fade-in zoom-in-50 duration-500 flex items-baseline gap-1 font-bold" style={{ color: UP_COLOR }}>
                    {levelText(to)}
                    <Check size={18} aria-label="更新しました" className="self-center" />
                  </span>
                  <span className="text-muted-foreground">{meaning(field, to)}</span>
                </span>
              ) : (
                <span className="flex items-baseline gap-2">
                  <span className={to === null ? "text-muted-foreground" : "font-bold"}>{levelText(to)}</span>
                  <span className="text-muted-foreground">{meaning(field, to)}</span>
                </span>
              )}
            </li>
          );
        })}
        <li className="flex items-baseline gap-3">
          <span className="w-10 shrink-0 font-bold">気分</span>
          <span className="flex flex-col">
            <span>{meaning("mood", checkin.mood) ?? "不明"}</span>
            <span className="text-muted-foreground">計画には使っていません</span>
          </span>
        </li>
      </ul>
    </Panel>
  );
}
