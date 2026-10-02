import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ReplanChatProposalSchema,
  ReplanChatResponseSchema,
  type DailyCheckin,
  type FixedEvent,
  type PlannedItem,
  type PlanningContext,
  type ReplanChatLlm,
  type ReplanChatProposal,
  type ReplanChatRequest,
  type ReplanChatResponse,
  type ReplanResponse,
} from "@/lib/schemas";
import { isLlmEnabled, LlmError } from "@/lib/llm/client";
import { buildReplanChatInput, callReplanChat, REPLAN_CHAT_TIMEOUT_MS, type ReplanChatFeedback } from "@/lib/llm/replan-chat";
import {
  buildOptionFacts,
  buildSummaryMessage,
  MIN_MESSAGE_TIMEOUT_MS,
  writeReplanChatMessage,
  type OptionFacts,
} from "@/lib/llm/replan-chat-message";
import { HttpError } from "@/lib/server/http";
import type { ReplanBase } from "@/lib/server/replan-base";
import {
  ENGINE_FAILED_MESSAGE,
  logEngineFailure,
  PROPOSAL_TTL_MINUTES,
  replanByIntent,
} from "@/lib/server/replan-by-intent";
import { buildReplanRows } from "@/lib/server/replan-rows";
import { upsertCheckin } from "@/lib/server/repositories/daily-checkins";
import type { PlanItemRow } from "@/lib/server/repositories/plans";
import {
  discardReplanProposals,
  getPlanVersion,
  getReplanProposalLabels,
  insertReplanProposal,
} from "@/lib/server/repositories/replan-proposals";
import { checkOption } from "./check";

// 会話の再計画：1ターンの流れ（replan-chat.md 12.11）。
// runReplanChatTurn は DB に触れない中身（DB・fallback は deps で受け取る）。runReplanChat が DB とつなぐ

// 1ターン全体の上限
export const TURN_BUDGET_MS = 15_000;
// 計画の呼び出しは、最初の1回を含めて最大3回（やり直しは最大2回）
const MAX_PLAN_CALLS = 3;

const SELECT_MESSAGE = (n: number) => `案${n}にしますね。よければ『この計画にする』を押してください。`;
const SELECT_UNKNOWN_MESSAGE = "どの案にするか、番号で教えてください。";
const DISCARD_MESSAGE = "わかりました。今の予定のままにします。";
const CHAT_DEFAULT_MESSAGE = "わかりました。予定を変えたいときは、いつでも教えてください。";
const QUESTION_DEFAULT_MESSAGE =
  "どう変えたいか、もう少し教えてください。（例：『20時から予定が入った』『今日は疲れた』）";
const NO_OPTIONS_ERROR = "案が1つもありません。options に1〜3個の案を入れてください";

export type SavedProposal = {
  proposal: ReplanChatProposal;
  updatedDays: { date: string; items: PlanItemRow[] }[];
  newFixedEvents: FixedEvent[];
};

export type ChatTurnInput = {
  request: ReplanChatRequest;
  context: PlanningContext; // 12.2 の 6 で作ったもの（書き換えない）
  beforeDays: { date: string; items: PlannedItem[] }[]; // 12.2 の engineBeforeDays
  openOptions: { index: number; label: string }[]; // 画面に出ている案（open_proposal_ids の順）
  storedRows: Map<string, PlanItemRow>;
  userId: string;
  weeklyPlanId: string;
};

export type ChatTurnDeps = {
  llmEnabled: () => boolean;
  fallback: () => Promise<ReplanChatResponse>; // 12.2 の経路
  saveProposals: (proposals: SavedProposal[]) => Promise<void>;
  discardProposals: (ids: string[]) => Promise<void>;
  updateFatigue: (fatigue: "high" | "medium") => Promise<DailyCheckin>;
  newId: () => string;
  elapsedMs: () => number; // ターンの始まりからの経過
};

const reply = (message: string, extra: Partial<ReplanChatResponse> = {}): ReplanChatResponse =>
  ReplanChatResponseSchema.parse({
    message,
    proposals: [],
    selected_proposal_id: null,
    discarded: false,
    source: "llm",
    ...extra,
  });

// 12.2 の経路の提案の label（intent.type から）
export function fallbackLabel(intentType: string | null | undefined): string | null {
  switch (intentType) {
    case "state_change":
      return "今夜は軽めにする";
    case "new_fixed_event":
      return "予定を入れる";
    case "task_change":
      return "タスクを後に回す";
    default:
      return null;
  }
}

// 12.2 の経路の結果 → 会話の返事（source: "fallback"）
export function toFallbackResponse(result: ReplanResponse): ReplanChatResponse {
  if ("supported" in result) return reply(result.message, { source: "fallback" });
  const proposal: ReplanChatProposal = {
    ...result,
    label: fallbackLabel(result.intent.type) ?? "予定を組み直す",
    warnings: [],
  };
  return reply(result.summary_message, { proposals: [proposal], source: "fallback" });
}

const isTiredPlan = (option: ReplanChatLlm["options"][number]) =>
  option.ops.length === 1 && option.ops[0].op === "tired_plan";

export async function runReplanChatTurn(input: ChatTurnInput, deps: ChatTurnDeps): Promise<ReplanChatResponse> {
  const { request } = input;
  // 2. LLM_MODE=off → 12.2 の経路
  if (!deps.llmEnabled()) return deps.fallback();

  let context = input.context;
  let feedback: ReplanChatFeedback[] = [];
  // 最後に通らなかった案の理由のうち、利用者に見せてよいもの（Engine・Validator の理由は除く）
  let userReasons: string[] = [];

  for (let call = 0; call < MAX_PLAN_CALLS; call += 1) {
    // やり直しの前に、1ターンの上限を超えそうなら打ち切る（計画の呼び出し＋説明の最小の時間）
    if (call > 0 && deps.elapsedMs() + REPLAN_CHAT_TIMEOUT_MS + MIN_MESSAGE_TIMEOUT_MS > TURN_BUDGET_MS) break;

    // 3. 計画の呼び出し（12.13 ①）
    let llm: ReplanChatLlm;
    try {
      llm = await callReplanChat(
        buildReplanChatInput({
          context,
          beforeDays: input.beforeDays,
          text: request.text,
          history: request.history,
          openOptions: input.openOptions,
          feedback,
        }),
      );
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      // 1回目の失敗 → 12.2 の経路。2回目以降 → できる範囲を伝える文（8）
      if (call === 0) return deps.fallback();
      break;
    }

    // 疲れ（high・medium）は reply_type に関係なく、今日のチェックインに入れる（12.2 の 6 と同じ。accept を待たない）
    if ((llm.fatigue === "high" || llm.fatigue === "medium") && context.checkin?.fatigue !== llm.fatigue) {
      context = { ...context, checkin: await deps.updateFatigue(llm.fatigue) };
    }

    // 4. reply_type ごと
    switch (llm.reply_type) {
      case "chat":
        return reply(llm.text?.trim() || CHAT_DEFAULT_MESSAGE);
      case "question":
        return reply(llm.text?.trim() || QUESTION_DEFAULT_MESSAGE);
      case "select": {
        const id = llm.select_index !== null ? request.open_proposal_ids[llm.select_index - 1] : undefined;
        if (!id) return reply(SELECT_UNKNOWN_MESSAGE);
        return reply(SELECT_MESSAGE(llm.select_index as number), { selected_proposal_id: id });
      }
      case "discard":
        await deps.discardProposals(request.open_proposal_ids);
        return reply(DISCARD_MESSAGE, { discarded: true });
      case "proposal":
        break;
    }

    // 5. 各案を検査する
    const options = llm.options.slice(0, 3);
    if (options.length === 0) {
      feedback = [{ label: "", errors: [NO_OPTIONS_ERROR] }];
      userReasons = [NO_OPTIONS_ERROR];
      continue;
    }
    const failedUserReasons: string[] = [];
    const passed: { label: string; tired: boolean; check: Extract<ReturnType<typeof checkOption>, { ok: true }> }[] = [];
    const failed: ReplanChatFeedback[] = [];
    options.forEach((option, i) => {
      const label = option.label.trim() || `案${i + 1}`;
      const check = checkOption({
        context,
        beforeDays: input.beforeDays,
        option: { label, ops: option.ops },
        fatigue: llm.fatigue,
        newId: deps.newId,
      });
      if (check.ok) passed.push({ label, tired: isTiredPlan(option), check });
      else {
        // LLM にはすべての理由を返す。Engine・Validator の理由はログにだけ出し、利用者には見せない
        failed.push({ label, errors: check.errors });
        if (check.engineErrors.length > 0) logEngineFailure("replan-chat", check.engineErrors);
        failedUserReasons.push(...check.errors.filter((error) => !check.engineErrors.includes(error)));
      }
    });

    // 7. 通った案だけを保存して、説明を作る
    if (passed.length > 0) {
      const saved: SavedProposal[] = [];
      const facts: OptionFacts[] = [];
      for (const { label, tired, check } of passed) {
        const rows = buildReplanRows({
          result: check.result,
          storedRows: input.storedRows,
          userId: input.userId,
          weeklyPlanId: input.weeklyPlanId,
          newId: deps.newId,
        });
        // 会話の経路の intent（12.9 の互換の形）。tired_plan は Engine の intent のまま
        const intent = tired
          ? rows.proposal.intent
          : {
              type: "preference_change" as const,
              fatigue: llm.fatigue,
              task_changes: [],
              new_fixed_events: check.newFixedEvents,
              preference_changes: [label],
            };
        const optionFacts = buildOptionFacts({ label, proposal: rows.proposal, warnings: check.warnings, tasks: context.tasks });
        facts.push(optionFacts);
        saved.push({
          proposal: ReplanChatProposalSchema.parse({
            ...rows.proposal,
            intent,
            proposal_id: deps.newId(),
            summary_message: buildSummaryMessage(optionFacts),
            label,
            warnings: check.warnings,
          }),
          updatedDays: rows.updatedDays,
          newFixedEvents: check.newFixedEvents,
        });
      }
      await deps.saveProposals(saved);
      const message = await writeReplanChatMessage({
        userText: request.text,
        options: facts,
        failed: [],
        timeoutMs: TURN_BUDGET_MS - deps.elapsedMs(),
      });
      return reply(message, { proposals: saved.map((entry) => entry.proposal) });
    }

    // 6. 全部だめ → 理由を feedback に入れてやり直す
    feedback = failed;
    userReasons = failedUserReasons;
  }

  // 8. 最後まで通らない → できる範囲を伝える文。proposals は空。
  // 見せてよい理由がない（Engine・Validator の失敗だけ）ときは、決まった文を返す
  const reasons = [...new Set(userReasons)];
  if (reasons.length === 0) return reply(ENGINE_FAILED_MESSAGE);
  const message = await writeReplanChatMessage({
    userText: request.text,
    options: [],
    failed: reasons,
    timeoutMs: TURN_BUDGET_MS - deps.elapsedMs(),
  });
  return reply(message);
}

// POST /api/plans/replan/chat の中身：DB・fallback をつないで runReplanChatTurn を呼ぶ
export async function runReplanChat(
  supabase: SupabaseClient,
  userId: string,
  base: Extract<ReplanBase, { ok: true }>,
  request: ReplanChatRequest,
): Promise<ReplanChatResponse> {
  const startedAt = performance.now();
  const { today, active } = base;

  // 画面に出ている案の label（自分の・今日の・pending のものだけ読める）
  const labels = await getReplanProposalLabels(supabase, userId, today, request.open_proposal_ids);
  const openOptions = request.open_proposal_ids.map((id, i) => {
    const stored = labels.get(id);
    return { index: i + 1, label: stored?.label ?? fallbackLabel(stored?.intent_type) ?? `案${i + 1}` };
  });

  return runReplanChatTurn(
    {
      request,
      context: base.context,
      beforeDays: base.engineBeforeDays,
      openOptions,
      storedRows: base.storedRows,
      userId,
      weeklyPlanId: active.id,
    },
    {
      llmEnabled: isLlmEnabled,
      fallback: async () => toFallbackResponse(await replanByIntent(supabase, userId, base, request.text)),
      saveProposals: async (proposals) => {
        // 12.2 の 9 と同じ（base_version ＝有効な計画の version、expires_at ＝実際の現在時刻＋30分）。案ごとに1行
        const version = await getPlanVersion(supabase, active.id);
        if (version === null) throw new HttpError(409, "INVALID_STATE", "先にプランを選んでください");
        const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MINUTES * 60_000).toISOString();
        for (const entry of proposals) {
          await insertReplanProposal(supabase, {
            id: entry.proposal.proposal_id,
            weekly_plan_id: active.id,
            date: today,
            proposal: entry.proposal,
            updated_days: entry.updatedDays,
            new_fixed_events: entry.newFixedEvents.map((event) => ({ ...event, user_id: userId })),
            base_version: version,
            expires_at: expiresAt,
          });
        }
      },
      discardProposals: (ids) => discardReplanProposals(supabase, userId, today, ids),
      updateFatigue: (fatigue) => upsertCheckin(supabase, userId, today, { fatigue }),
      newId: () => crypto.randomUUID(),
      elapsedMs: () => performance.now() - startedAt,
    },
  );
}
