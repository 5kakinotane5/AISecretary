"use client";

import type { ReactNode } from "react";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { ConnectionBadge } from "./ConnectionBadge";
import { DirectionPanel } from "./DirectionPanel";
import { FitPanel } from "./FitPanel";
import { LogPanel } from "./LogPanel";
import { Panel } from "./parts";
import { RadarPanel } from "./RadarPanel";
import { StageBar } from "./StageBar";
import { StatePanel } from "./StatePanel";
import { useEngineStream } from "./useEngineStream";

// /engine-view：状態を伝えると Planning Engine のパラメータが動く様子（docs/design/engine-view.md）。PC 幅の横長の画面

export function EngineViewShell({ badge, children }: { badge: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-[1440px] min-w-[1280px] flex-col gap-4 p-6 text-base">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">エンジンビュー（Planning Engine）</h1>
        {badge}
      </header>
      {children}
    </main>
  );
}

export function EngineViewScreen() {
  const { view, connection } = useEngineStream();
  const { turn } = view;
  return (
    <EngineViewShell badge={<ConnectionBadge state={connection} />}>
      {turn ? (
        <>
          <SurfaceCard>
            <StageBar turn={turn} />
          </SurfaceCard>
          <div className="grid grid-cols-[460px_1fr_420px] items-start gap-4">
            <div className="flex flex-col gap-4">
              <StatePanel turn={turn} />
              <DirectionPanel turn={turn} />
            </div>
            <FitPanel turn={turn} />
            <RadarPanel turn={turn} />
          </div>
        </>
      ) : (
        <SurfaceCard className="py-10 text-center text-lg text-muted-foreground">
          /today で今日の調子を「決定」するか、/replan で話しかけると、ここに Planning Engine の動きが出ます
        </SurfaceCard>
      )}
      <Panel title="ログ">
        <LogPanel log={view.log} />
      </Panel>
    </EngineViewShell>
  );
}
