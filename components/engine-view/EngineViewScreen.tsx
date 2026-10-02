"use client";

import type { ReactNode } from "react";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import type { ViewState } from "@/lib/engine-view/view-state";
import { ConnectionBadge } from "./ConnectionBadge";
import { DirectionPanel } from "./DirectionPanel";
import { FitPanel } from "./FitPanel";
import { LogPanel } from "./LogPanel";
import { RadarPanel } from "./RadarPanel";
import { TopBar } from "./StageBar";
import { StatePanel } from "./StatePanel";
import { useEngineStream } from "./useEngineStream";

// /engine-view：状態を伝えると Planning Engine のパラメータが動く様子（docs/design/engine-view.md）。
// PC 幅の横長の画面。録画のため 1440×940 でスクロールなしに収める

export function EngineViewShell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-[1440px] min-w-[1280px] flex-col gap-3 px-6 py-4 text-base">{children}</main>;
}

export function EngineViewBody({ view, badge }: { view: ViewState; badge: ReactNode }) {
  const { turn } = view;
  return (
    <EngineViewShell>
      <TopBar turn={turn} badge={badge} />
      {turn ? (
        <div className="grid grid-cols-[460px_1fr_420px] items-start gap-3">
          <div className="flex flex-col gap-3">
            <StatePanel turn={turn} />
            <DirectionPanel turn={turn} />
          </div>
          <FitPanel turn={turn} />
          <RadarPanel turn={turn} />
        </div>
      ) : (
        <SurfaceCard className="py-10 text-center text-lg text-muted-foreground">
          /today で今日の調子を「決定」するか、/replan で話しかけると、ここに Planning Engine の動きが出ます
        </SurfaceCard>
      )}
      <LogPanel log={view.log} />
    </EngineViewShell>
  );
}

export function EngineViewScreen() {
  const { view, connection } = useEngineStream();
  return <EngineViewBody view={view} badge={<ConnectionBadge state={connection} />} />;
}
