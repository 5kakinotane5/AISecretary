import type { NextRequest } from "next/server";
import {
  ReplanProposalSchema,
  ReplanRequestSchema,
  ReplanResponseSchema,
  ScheduleItemSchema,
  type DayPlan,
  type PlannedItem,
  type ReplanChange,
  type ScheduleItem,
} from "@/lib/schemas";
import { addDays, ceilToMinutes, formatTime, getWeekStart, toDateStr } from "@/lib/datetime";
import { extractReplanIntentByKeywords, type ReplanTaskOption } from "@/lib/llm/replan-keywords";
import { handle, HttpError, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { withDisplayState } from "@/lib/server/calendar";
import { getNow } from "@/lib/server/clock";
import { buildPlanningContext } from "@/lib/server/planning-context";
import { PROVISIONAL_END_NOTE, toReplanningIntent } from "@/lib/server/replan-intent";
import { upsertCheckin } from "@/lib/server/repositories/daily-checkins";
import { getActivePlan, listPlanItems, type PlanItemRow } from "@/lib/server/repositories/plans";
import {
  getPlanVersion,
  insertReplanProposal,
  listPlanItemRows,
  type FixedEventRow,
} from "@/lib/server/repositories/replan-proposals";
// TODO: 長沼の ★6 がマージされたら "@/lib/planning/replan" に替え、lib/server/replan-stub.ts を消す
import { replan } from "@/lib/server/replan-stub";

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

    // 1. 今日だけ（補正 C-12）
    const now = await getNow(user.id, supabase);
    const today = toDateStr(now);
    if (body.date !== today) return unsupported(NOT_TODAY_MESSAGE);

    // 2. 有効な計画が今週のもの
    const active = await getActivePlan(supabase);
    if (!active || active.week_start !== getWeekStart(today)) {
      throw new HttpError(409, "INVALID_STATE", "先にプランを選んでください");
    }

    // 5（先に読む）. Before：有効な計画の7日分に、表示用の計算（11.3。locked・completed）をかける
    const entries = (await listPlanItems(supabase, [active.id])).get(active.id) ?? [];
    const beforeDays: DayPlan[] = Array.from({ length: 7 }, (_, i) =>
      addDays(active.week_start, i),
    ).map((date) => ({
      date,
      items: entries.filter((e) => e.date === date).map((e) => withDisplayState(e.item, now)),
    }));
    const beforeToday = beforeDays.find((d) => d.date === today)?.items ?? [];

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
    // TODO: LLM_MODE=on（lib/llm/replan-intent.ts、12.3.1）を作ったら、LLM で取り出し、失敗したらキーワードにする
    const converted = toReplanningIntent(extractReplanIntentByKeywords(body.text, todayTasks), {
      date: today,
      now,
      todayTasks,
    });
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

    // 6. state_change なら、今日のチェックインの fatigue を先に更新する（計画ではないので accept を待たない）
    if (intent.type === "state_change") {
      await upsertCheckin(supabase, user.id, today, { fatigue: intent.fatigue });
    }

    // 6. PlanningContext：style ＝有効な計画の style、足す予定を fixed_events に入れる、locked_items に今日の locked な項目。
    // now をまたぐ自由時間・バッファ（locked: false）は、作業用のコピーを now（5分単位に切り上げ）で切り、
    // 前半を locked の項目として入れる。後半は空きとして扱う（Before の項目は切らない）
    const context = await buildPlanningContext(supabase, user.id, active.style);
    const cut = ceilToMinutes(now, 5);
    const lockedToday: ScheduleItem[] = [];
    for (const item of beforeToday) {
      if (item.locked) {
        lockedToday.push(item);
      } else if (
        (item.kind === "free" || item.kind === "buffer") &&
        Date.parse(item.start_at) < Date.parse(now) &&
        Date.parse(cut) < Date.parse(item.end_at)
      ) {
        lockedToday.push({ ...item, id: `${item.id}_before_now`, end_at: cut, locked: true });
      }
    }
    const lockedIds = new Set(context.locked_items.map((item) => item.id));
    context.locked_items = [
      ...context.locked_items,
      ...lockedToday.filter((item) => !lockedIds.has(item.id)),
    ];
    context.fixed_events = [...context.fixed_events, ...intent.new_fixed_events];

    // 7. Engine
    const result = replan(context, beforeDays, intent);
    if (!result.ok) {
      const { reason, required_changes } = result.infeasible;
      return unsupported(
        required_changes.length > 0 ? `${reason}（${required_changes.join("／")}）` : reason,
      );
    }

    // 8. updated_days の全項目に新しい UUID を振る。after 側（proposal.after・changes の after）も同じ対応で置き換える。
    // before 側は元の id のまま（画面が before の id で「変更なし」を数える）。
    // 今日の locked な項目は Before の値のまま、carried は保存されている値を引き継ぐ
    const storedRows = await listPlanItemRows(supabase, active.id);
    const lockedBefore = new Map(
      beforeToday.filter((item) => item.locked).map((item) => [item.id, item]),
    );
    const idMap = new Map<string, string>();
    const newId = (oldId: string) => {
      let id = idMap.get(oldId);
      if (!id) {
        id = crypto.randomUUID();
        idMap.set(oldId, id);
      }
      return id;
    };
    const toRow = (item: PlannedItem, date: string): PlanItemRow => {
      const stored = storedRows.get(item.id);
      const base = lockedBefore.get(item.id) ?? ScheduleItemSchema.parse(item);
      return {
        ...ScheduleItemSchema.parse(base),
        id: newId(item.id),
        user_id: user.id,
        weekly_plan_id: active.id,
        date,
        // Engine は Before（reason_code なし）から写した項目の reason_code を知らないので、理由が同じなら保存されている値を使う
        reason_code:
          item.reason_code ?? (stored && stored.reason === base.reason ? stored.reason_code : null),
        carried: stored?.carried ?? false,
      };
    };
    const updatedDays = result.updated_days.map((day) => ({
      date: day.date,
      items: day.items.map((item) => toRow(item, day.date)),
    }));
    const remap = (item: ScheduleItem): ScheduleItem => ({ ...item, id: newId(item.id) });
    const remapChange = (change: ReplanChange): ReplanChange => ({
      ...change,
      after: change.after.map(remap),
    });

    const proposalId = crypto.randomUUID();
    const proposal = ReplanProposalSchema.parse({
      ...result.proposal,
      proposal_id: proposalId,
      after: { date: result.proposal.after.date, items: result.proposal.after.items.map(remap) },
      changes: result.proposal.changes.map(remapChange),
      other_day_changes: result.proposal.other_day_changes.map(remapChange),
      // 終わりの時刻を仮置きした予定があれば、そのことを伝える（補正 C-10）
      summary_message:
        converted.provisional_end && !result.proposal.summary_message.includes(PROVISIONAL_END_NOTE)
          ? `${result.proposal.summary_message}${PROVISIONAL_END_NOTE}`
          : result.proposal.summary_message,
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
