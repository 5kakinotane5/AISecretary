import type { SupabaseClient } from "@supabase/supabase-js";
import { ReplanProposalSchema, ReplanResponseSchema, type ReplanResponse } from "@/lib/schemas";
import { formatTime, toDateStr } from "@/lib/datetime";
import type { ReplanTaskOption } from "@/lib/llm/replan-keywords";
import { HttpError } from "@/lib/server/http";
import type { ReplanBase } from "@/lib/server/replan-base";
import { extractReplanIntent, PROVISIONAL_END_NOTE } from "@/lib/server/replan-intent";
import { buildReplanRows } from "@/lib/server/replan-rows";
import { upsertCheckin } from "@/lib/server/repositories/daily-checkins";
import {
  getPlanVersion,
  insertReplanProposal,
  type FixedEventRow,
} from "@/lib/server/repositories/replan-proposals";
import { replan } from "@/lib/planning/replan";

// 意図＋Engine の再計画（plans-replan.md 12.2 の 3・4・6〜10）。
// POST /api/plans/replan と、会話の経路（replan-chat.md 12.11）の fallback で共通に使う

// 12.3.3 対応していないときの返事
export const UNSUPPORTED_MESSAGE =
  "ごめんなさい、この内容はまだ計画に反映できません。『今日は疲れた』『20時から1時間予定が入った』『今日はもう勉強したくない』のように教えてください。";
export const NOT_TODAY_MESSAGE = "今日の予定だけ変更できます。";
export const PROPOSAL_TTL_MINUTES = 30;
// Engine・Validator が失敗したときの返事（細かい理由は利用者に見せない）
export const ENGINE_FAILED_MESSAGE = "うまく組み直せませんでした。時間や内容を変えて教えてください。";

// Engine・Validator の理由をサーバーのログに出す（利用者の発言は渡さない・出さない）
export function logEngineFailure(scope: string, reasons: readonly string[]): void {
  console.warn(`[${scope}] engine failed: ${reasons.join(" / ")}`);
}

const unsupported = (message: string) => ReplanResponseSchema.parse({ supported: false, message });

const overlaps = (
  a: { start_at: string; end_at: string },
  b: { start_at: string; end_at: string },
) => Date.parse(a.start_at) < Date.parse(b.end_at) && Date.parse(b.start_at) < Date.parse(a.end_at);

// 「19:00」。その日の 24:00（翌日 0:00）は「24:00」
function timeLabel(iso: string, date: string): string {
  return toDateStr(iso) > date ? "24:00" : formatTime(iso);
}

// base は loadReplanBase() の ok: true の値。base.context は書き換えない
export async function replanByIntent(
  supabase: SupabaseClient,
  userId: string,
  base: Extract<ReplanBase, { ok: true }>,
  text: string,
): Promise<ReplanResponse> {
  const { now, today, active, beforeToday, engineBeforeDays, storedRows } = base;
  const context = { ...base.context };

  // 3. 意図を取り出す（12.3）。今日の now 以降のタスク項目を渡す
  const todayTasks: ReplanTaskOption[] = beforeToday
    .filter(
      (item) =>
        item.kind === "task" &&
        item.task_id !== null &&
        Date.parse(item.start_at) >= Date.parse(now),
    )
    .map((item) => ({
      task_id: item.task_id as string,
      title: item.title,
      start_at: item.start_at,
      end_at: item.end_at,
    }));
  // LLM_MODE=on なら LLM（12.3.1）。失敗したとき・off のときはキーワード（12.3.2）
  const converted = await extractReplanIntent(text, { date: today, now, todayTasks });
  if (converted.type === "unknown") return unsupported(UNSUPPORTED_MESSAGE);
  const { intent } = converted;
  if (intent.type === "preference_change") return unsupported(UNSUPPORTED_MESSAGE);
  // fatigue が low・null の state_change は対応しない（12.4 A）
  if (
    intent.type === "state_change" &&
    intent.fatigue !== "high" &&
    intent.fatigue !== "medium"
  ) {
    return unsupported(UNSUPPORTED_MESSAGE);
  }

  // 4. 足す予定が、今日の固定予定・睡眠と重なれば入れない（補正 C-22）
  for (const event of intent.new_fixed_events) {
    const hit = beforeToday.find(
      (item) => (item.kind === "fixed" || item.kind === "sleep") && overlaps(item, event),
    );
    if (hit) {
      return unsupported(
        `${hit.title}（${timeLabel(hit.start_at, today)}〜${timeLabel(hit.end_at, today)}）と重なるため、この予定は入れられません。時刻を変えて教えてください。`,
      );
    }
  }

  // 6. state_change なら、今日のチェックインの fatigue を更新する（計画ではないので accept を待たない）。
  // context は更新前に読んだので、更新後のチェックインに差し替える
  if (intent.type === "state_change") {
    context.checkin = await upsertCheckin(supabase, userId, today, { fatigue: intent.fatigue });
  }

  // 6. 足す予定を fixed_events に入れる
  context.fixed_events = [...context.fixed_events, ...intent.new_fixed_events];

  // 7. Engine。Before の項目には保存されている reason_code を付けて渡す
  // 成立しない・検証に失敗したとき：細かい理由はサーバーのログにだけ出し、利用者には決まった文を返す
  const result = replan(context, engineBeforeDays, intent);
  if (!result.ok) {
    logEngineFailure("replan", [result.infeasible.reason, ...result.infeasible.required_changes]);
    return unsupported(ENGINE_FAILED_MESSAGE);
  }

  // 8. updated_days の全項目に新しい UUID を振り、保存する行と after 側の id を組み立てる（lib/server/replan-rows.ts）。
  // 行の中身は Engine の項目のまま（Engine が now で切った進行中のタスクを Before の値で戻さない。FR-12-4 の例外）
  const rows = buildReplanRows({
    result,
    storedRows,
    userId,
    weeklyPlanId: active.id,
    newId: () => crypto.randomUUID(),
  });

  const proposalId = crypto.randomUUID();
  const proposal = ReplanProposalSchema.parse({
    ...rows.proposal,
    proposal_id: proposalId,
    // 終わりの時刻を仮置きした予定があれば、そのことを伝える（補正 C-10）
    summary_message:
      converted.provisional_end && !rows.proposal.summary_message.includes(PROVISIONAL_END_NOTE)
        ? `${rows.proposal.summary_message}${PROVISIONAL_END_NOTE}`
        : rows.proposal.summary_message,
  });

  // 9. 保存（base_version ＝有効な計画の version、expires_at ＝実際の現在時刻＋30分）
  const version = await getPlanVersion(supabase, active.id);
  if (version === null) throw new HttpError(409, "INVALID_STATE", "先にプランを選んでください");
  const newFixedEvents: FixedEventRow[] = intent.new_fixed_events.map((event) => ({
    ...event,
    user_id: userId,
  }));
  await insertReplanProposal(supabase, {
    id: proposalId,
    weekly_plan_id: active.id,
    date: today,
    proposal,
    updated_days: rows.updatedDays,
    new_fixed_events: newFixedEvents,
    base_version: version,
    expires_at: new Date(Date.now() + PROPOSAL_TTL_MINUTES * 60_000).toISOString(),
  });

  // 10. ReplanProposal を返す（モックと同じ形）
  return ReplanResponseSchema.parse(proposal);
}
