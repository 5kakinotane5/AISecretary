import type { NextRequest } from "next/server";
import { ReplanProposalSchema, ReplanRequestSchema, ReplanResponseSchema } from "@/lib/schemas";
import { formatTime, toDateStr } from "@/lib/datetime";
import type { ReplanTaskOption } from "@/lib/llm/replan-keywords";
import { handle, HttpError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { loadReplanBase } from "@/lib/server/replan-base";
import { extractReplanIntent, PROVISIONAL_END_NOTE } from "@/lib/server/replan-intent";
import { buildReplanRows } from "@/lib/server/replan-rows";
import { upsertCheckin } from "@/lib/server/repositories/daily-checkins";
import {
  getPlanVersion,
  insertReplanProposal,
  type FixedEventRow,
} from "@/lib/server/repositories/replan-proposals";
import { replan } from "@/lib/planning/replan";

// 12.3.3 対応していないときの返事
const UNSUPPORTED_MESSAGE =
  "ごめんなさい、この内容はまだ計画に反映できません。『今日は疲れた』『20時から1時間予定が入った』『今日はもう勉強したくない』のように教えてください。";
const NOT_TODAY_MESSAGE = "今日の予定だけ変更できます。";
const PROPOSAL_TTL_MINUTES = 30;

const unsupported = (message: string) => ReplanResponseSchema.parse({ supported: false, message });

const overlaps = (
  a: { start_at: string; end_at: string },
  b: { start_at: string; end_at: string },
) => Date.parse(a.start_at) < Date.parse(b.end_at) && Date.parse(b.start_at) < Date.parse(a.end_at);

// 「19:00」。その日の 24:00（翌日 0:00）は「24:00」
function timeLabel(iso: string, date: string): string {
  return toDateStr(iso) > date ? "24:00" : formatTime(iso);
}

// POST /api/plans/replan（plans-replan.md 12.1・12.2）：{ date, text } → ReplanProposal か { supported: false, message }
export async function POST(request: NextRequest) {
  return handle(request, async () => {
    const { user, supabase } = await requireUser();
    const body = await parseBody(request, ReplanRequestSchema);

    // 1・2・5・6. 今日だけ（補正 C-12）・有効な計画・Before・PlanningContext（lib/server/replan-base.ts）
    const base = await loadReplanBase(supabase, user.id, body.date);
    if (!base.ok) return unsupported(NOT_TODAY_MESSAGE);
    const { now, today, active, beforeToday, engineBeforeDays, storedRows, context } = base;

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
    const converted = await extractReplanIntent(body.text, { date: today, now, todayTasks });
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
      context.checkin = await upsertCheckin(supabase, user.id, today, { fatigue: intent.fatigue });
    }

    // 6. 足す予定を fixed_events に入れる
    context.fixed_events = [...context.fixed_events, ...intent.new_fixed_events];

    // 7. Engine。Before の項目には保存されている reason_code を付けて渡す
    const result = replan(context, engineBeforeDays, intent);
    if (!result.ok) {
      const { reason, required_changes } = result.infeasible;
      return unsupported(
        required_changes.length > 0 ? `${reason}（${required_changes.join("／")}）` : reason,
      );
    }

    // 8. updated_days の全項目に新しい UUID を振り、保存する行と after 側の id を組み立てる（lib/server/replan-rows.ts）。
    // 行の中身は Engine の項目のまま（Engine が now で切った進行中のタスクを Before の値で戻さない。FR-12-4 の例外）
    const rows = buildReplanRows({
      result,
      storedRows,
      userId: user.id,
      weeklyPlanId: active.id,
      newId: () => crypto.randomUUID(),
    });
    const updatedDays = rows.updatedDays;

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
      user_id: user.id,
    }));
    await insertReplanProposal(supabase, {
      id: proposalId,
      weekly_plan_id: active.id,
      date: today,
      proposal,
      updated_days: updatedDays,
      new_fixed_events: newFixedEvents,
      base_version: version,
      expires_at: new Date(Date.now() + PROPOSAL_TTL_MINUTES * 60_000).toISOString(),
    });

    // 10. ReplanProposal を返す（モックと同じ形）
    return ReplanResponseSchema.parse(proposal);
  });
}
