import type { NextRequest } from "next/server";
import {
  GeneratePlansRequestSchema,
  GeneratePlansResponseSchema,
  ScheduleItemSchema,
  type EnginePlan,
} from "@/lib/schemas";
import { generatePlans } from "@/lib/planning/generate";
import { handle, HttpError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { buildPlanningContext } from "@/lib/server/planning-context";
import { getInterviewSession } from "@/lib/server/repositories/interview";
import { saveGeneration, type PlanItemRow, type WeeklyPlanRow } from "@/lib/server/repositories/plans";

// 1案の項目を保存する行にする。id はすべて新しい UUID に振り直す（10.2）。
// locked_items から写した項目（元の id のまま出てくる）は carried = true（11.1）
function toItemRows(plan: EnginePlan, planId: string, userId: string, lockedIds: Set<string>): PlanItemRow[] {
  return plan.days.flatMap((day) =>
    day.items.map((item) => ({
      ...ScheduleItemSchema.parse(item),
      id: crypto.randomUUID(),
      user_id: userId,
      weekly_plan_id: planId,
      date: day.date,
      reason_code: item.reason_code,
      carried: lockedIds.has(item.id),
    })),
  );
}

// POST /api/plans/generate（plans-replan.md 11.1）：{ session_id } → { candidates }（intensive・balanced・relaxed の順）
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const body = await parseBody(request, GeneratePlansRequestSchema);

    // 1. セッションが自分のもので、READY_FOR_PLANNING か PLAN_PROPOSED
    const session = await getInterviewSession(supabase, body.session_id);
    if (!session) throw new HttpError(404, "NOT_FOUND", "ヒアリングが見つかりません。最初からやり直してください");
    if (session.state !== "READY_FOR_PLANNING" && session.state !== "PLAN_PROPOSED") {
      throw new HttpError(409, "INVALID_STATE", "スケジュール作成は目標の確定後に行えます");
    }

    // 2〜3. PlanningContext を作り、3案を生成する
    const context = await buildPlanningContext(supabase, user.id, null);
    const startedAt = performance.now();
    const result = generatePlans(context);
    // Vercel の制限時間の目安にするため、生成にかかった時間だけをログに出す（中身は出さない）
    console.info(`[plans/generate] generatePlans ${Math.round(performance.now() - startedAt)}ms ok=${result.ok}`);
    if (!result.ok) {
      const { reason, required_changes } = result.infeasible;
      const message = required_changes.length > 0 ? `${reason}（${required_changes.join("／")}）` : reason;
      throw new HttpError(422, "INFEASIBLE", message);
    }

    // 4. generation_id・3案の id・全項目の id を UUID で作る
    const generationId = crypto.randomUUID();
    const lockedIds = new Set(context.locked_items.map((item) => item.id));
    const plans = result.plans.map((plan) => ({ id: crypto.randomUUID(), plan }));
    const planRows: WeeklyPlanRow[] = plans.map(({ id, plan }) => ({
      id,
      generation_id: generationId,
      week_start: plan.week_start,
      style: plan.style,
      label: plan.label,
      summary: plan.summary,
      features: plan.features,
    }));
    const itemRows = plans.flatMap(({ id, plan }) => toItemRows(plan, id, user.id, lockedIds));

    // 5. 保存し、セッションを PLAN_PROPOSED にする
    await saveGeneration(supabase, session.id, planRows, itemRows);

    // 6. 保存した id で返す（reason_code・features は parse で落ちる）
    return GeneratePlansResponseSchema.parse({
      candidates: plans.map(({ id, plan }) => ({
        id,
        style: plan.style,
        label: plan.label,
        week_start: plan.week_start,
        summary: plan.summary,
        days: plan.days.map((day) => ({
          date: day.date,
          items: itemRows.filter((row) => row.weekly_plan_id === id && row.date === day.date),
        })),
      })),
    });
  });
}
