import type { SupabaseClient } from "@supabase/supabase-js";
import { toDateStr } from "@/lib/datetime";
import { getNow } from "@/lib/server/clock";
import { HttpError } from "@/lib/server/http";
import { buildPlanningContext } from "@/lib/server/planning-context";
import { loadReplanBase } from "@/lib/server/replan-base";
import type { CheckinEngineView, EngineViewBase } from "./checkin";
import { publish } from "./bus";
import type { EngineEmit, EngineEventSource } from "@/lib/engine-view/events";

// 発表用の別画面のための読み込みと、1ターンの emit。ENGINE_VIEW=on のときだけ呼ぶ

// 今の PlanningContext と有効な計画の7日分。会話の再計画と同じ作り方（loadReplanBase）。
// 有効な計画がない（409）ときは、style なしの context だけを返す
export async function loadEngineViewBase(supabase: SupabaseClient, userId: string): Promise<EngineViewBase> {
  const today = toDateStr(await getNow(userId, supabase));
  try {
    const base = await loadReplanBase(supabase, userId, today);
    if (base.ok) return { context: base.context, days: base.engineBeforeDays };
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 409)) throw e;
  }
  return { context: await buildPlanningContext(supabase, userId, null), days: null };
}

// turn_id・user_id・開始時刻を閉じ込めた emit（publish は例外を外に投げない）
export function createTurnEmitter(userId: string, source: EngineEventSource): { emit: EngineEmit; elapsedMs: () => number } {
  const turnId = crypto.randomUUID();
  const startedAt = performance.now();
  const elapsedMs = () => Math.round(performance.now() - startedAt);
  return {
    emit: (event) => publish({ ...event, turn_id: turnId, user_id: userId, source, t_ms: elapsedMs() }),
    elapsedMs,
  };
}

export function createCheckinEngineView(supabase: SupabaseClient, userId: string): CheckinEngineView {
  const { emit, elapsedMs } = createTurnEmitter(userId, "checkin");
  return { load: () => loadEngineViewBase(supabase, userId), emit, elapsedMs };
}
