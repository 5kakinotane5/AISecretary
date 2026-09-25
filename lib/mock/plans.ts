import type { ScheduleCandidate } from "@/lib/schemas";
import { INTENSIVE_PLAN } from "@/mocks/plans/intensive";
import { BALANCED_PLAN } from "@/mocks/plans/balanced";
import { RELAXED_PLAN } from "@/mocks/plans/relaxed";

/**
 * スケジュール3案（5.9章の固定データ）。POST /api/plans/generate と GET /api/plans/candidates で共通に使う。
 * 目標時間3案の選択に関わらず同じ内容を返す（10.3章：モックの制限）。
 */
export function getPlanCandidates(): ScheduleCandidate[] {
  return [INTENSIVE_PLAN, BALANCED_PLAN, RELAXED_PLAN];
}
