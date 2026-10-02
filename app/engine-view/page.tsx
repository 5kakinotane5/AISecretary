import type { Metadata } from "next";
import { connection } from "next/server";
import { ConnectionBadge } from "@/components/engine-view/ConnectionBadge";
import { EngineViewScreen, EngineViewShell } from "@/components/engine-view/EngineViewScreen";
import { TopBar } from "@/components/engine-view/StageBar";
import { isEngineViewEnabled } from "@/lib/server/engine-view/bus";

// /engine-view（docs/design/engine-view.md 13-2）：発表用の別画面。(main) の外に置き、下のナビは出さない。
// ログインは proxy.ts で必要。ENGINE_VIEW が on でなければ、起動の仕方だけを出す

export const metadata: Metadata = { title: "エンジンビュー | PURCHART" };

export default async function EngineViewPage() {
  // ENGINE_VIEW はリクエストのときに読む（ビルドのときの値で固めない）
  await connection();
  if (!isEngineViewEnabled()) {
    return (
      <EngineViewShell>
        <TopBar turn={null} badge={<ConnectionBadge state="off" />}>
          <p className="py-10 text-center text-lg">ENGINE_VIEW=on で起動してください</p>
        </TopBar>
      </EngineViewShell>
    );
  }
  return <EngineViewScreen />;
}
