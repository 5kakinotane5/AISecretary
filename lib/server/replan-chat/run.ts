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
  type Task,
} from "@/lib/schemas";
import { formatDateShort, toDateStr } from "@/lib/datetime";
import { isLlmEnabled, LlmError } from "@/lib/llm/client";
import { mentionsFatigue, taskKeys } from "@/lib/llm/replan-keywords";
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
import { buildNewTaskRows, buildReplanRows } from "@/lib/server/replan-rows";
import { upsertCheckin } from "@/lib/server/repositories/daily-checkins";
import type { PlanItemRow } from "@/lib/server/repositories/plans";
import {
  discardReplanProposals,
  getPlanVersion,
  getReplanProposalLabels,
  insertReplanProposal,
  type ReplanProposalInsert,
} from "@/lib/server/repositories/replan-proposals";
import { isEngineViewEnabled } from "@/lib/server/engine-view/bus";
import type { EngineEmit } from "@/lib/engine-view/events";
import { createTurnEmitter } from "@/lib/server/engine-view/load";
import { createReplanTurnView, type ReplanTurnView } from "@/lib/server/engine-view/replan";
import { checkOption } from "./check";

// 会話の再計画：1ターンの流れ（replan-chat.md 12.11）。
// runReplanChatTurn は DB に触れない中身（DB・fallback は deps で受け取る）。runReplanChat が DB とつなぐ

// 1ターン全体の上限
export const TURN_BUDGET_MS = 15_000;
// 計画の呼び出しは、最初の1回を含めて最大3回（やり直しは最大2回）
const MAX_PLAN_CALLS = 3;

const SELECT_MESSAGE = (n: number) => `案${n}にしますね。よければ『この計画にする』を押してください。`;
// 出ている案がない・番号が範囲外の select：1回だけやり直し、それでもだめなら聞き返す
const SELECT_INVALID_FEEDBACK = "出ている案はありません。発言をもう一度読んで proposal か question にしてください";
const SELECT_INVALID_QUESTION = "どのタスクのことか教えてください";
const DISCARD_MESSAGE = "わかりました。今の予定のままにします。";
const CHAT_DEFAULT_MESSAGE = "わかりました。予定を変えたいときは、いつでも教えてください。";
const QUESTION_DEFAULT_MESSAGE =
  "どう変えたいか、もう少し教えてください。（例：『20時から予定が入った』『今日は疲れた』）";
const NO_OPTIONS_ERROR = "案が1つもありません。options に1〜3個の案を入れてください";

export type SavedProposal = {
  proposal: ReplanChatProposal;
  updatedDays: { date: string; items: PlanItemRow[] }[];
  newFixedEvents: FixedEvent[]; // 1回きり・毎週（recurrence "weekly"）の予定
  newTasks: Task[]; // add_task で足したタスク（replan-add.md 12.19）
};

// replan_proposals に保存する1行（12.2 の 9・replan-add.md 12.19）。DB・時計には触れない
export function buildProposalInsert(
  entry: SavedProposal,
  values: { weeklyPlanId: string; date: string; userId: string; now: string; version: number; expiresAt: string },
): ReplanProposalInsert {
  return {
    id: entry.proposal.proposal_id,
    weekly_plan_id: values.weeklyPlanId,
    date: values.date,
    proposal: entry.proposal,
    updated_days: entry.updatedDays,
    new_fixed_events: entry.newFixedEvents.map((event) => ({ ...event, user_id: values.userId })),
    ...(entry.newTasks.length > 0
      ? { new_tasks: buildNewTaskRows({ tasks: entry.newTasks, userId: values.userId, now: values.now }) }
      : {}),
    base_version: values.version,
    expires_at: values.expiresAt,
  };
}

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
  // 発表用の別画面（/engine-view）に出来事を流す。省略したら何もしない（計算もしない）
  emit?: EngineEmit;
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

// 休憩・ゆるめたいことば。疲れのキーワード（mentionsFatigue）とあわせて、どちらにも当たらない発言では
// tired_plan・add_rest を含む案（頼まれていない仮眠・今夜軽め）を出さない
const REST_WORDS = /休憩|休み|仮眠|寝|横にな|ひと息|一息|ゆる|軽め|軽く/;
const asksForRest = (text: string) => mentionsFatigue(text) || REST_WORDS.test(text.normalize("NFKC"));
const hasRestOp = (option: ReplanChatLlm["options"][number]) =>
  option.ops.some((entry) => entry.op === "tired_plan" || entry.op === "add_rest");

type ChatOps = ReplanChatLlm["options"][number]["ops"];
type ChatOp = ChatOps[number];
// 前の試みで通らなかった案（ops と、利用者に見せてよい理由）
type FailedAttempt = { ops: ChatOps; errors: string[] };

// add_event の「同じ種類」（title と repeat）と、その日（once は date、weekly は曜日）
const eventKind = (entry: ChatOp) => `${entry.title?.trim() ?? ""}|${entry.repeat ?? "once"}`;
const eventDay = (entry: ChatOp, today: string) =>
  entry.repeat === "weekly" ? `w:${entry.weekday ?? ""}` : `d:${entry.date ?? today}`;
const dayLabel = (entry: ChatOp, today: string) =>
  entry.repeat === "weekly" ? `毎週${entry.weekday ?? ""}曜` : formatDateShort(entry.date ?? today);

// やり直しの後に通った案で外した日と理由（facts の dropped。replan-chat.md 12.12 の補い）。
// 前の試みにあって通った案にない「同じ種類の add_event の日」を、その op だけの案で検査し直して理由を得る。
// 見つからず、通った案の ops が前の試みより少ないときは、前の試みの理由をそのまま使う
function droppedReasons(
  ops: ChatOps,
  attempts: readonly FailedAttempt[],
  check: (entry: ChatOp) => string | null,
  today: string,
): string[] {
  const events = ops.filter((entry) => entry.op === "add_event");
  const kinds = new Set(events.map(eventKind));
  const days = new Set(events.map((entry) => `${eventKind(entry)}|${eventDay(entry, today)}`));
  const dropped = new Map<string, ChatOp>();
  for (const attempt of attempts) {
    for (const entry of attempt.ops) {
      if (entry.op !== "add_event" || !kinds.has(eventKind(entry))) continue;
      const key = `${eventKind(entry)}|${eventDay(entry, today)}`;
      if (!days.has(key) && !dropped.has(key)) dropped.set(key, entry);
    }
  }
  const reasons = [...dropped.values()].flatMap((entry) => {
    const error = check(entry);
    return error ? [`${dayLabel(entry, today)}は${error.replace(/入れられません$/, "入れていません")}`] : [];
  });
  if (reasons.length > 0) return reasons;
  const larger = [...attempts].reverse().find((attempt) => attempt.ops.length > ops.length);
  return larger ? [...new Set(larger.errors)] : [];
}

// label が、その案で postpone・skip・shorten するタスクのどれかの名前（taskKeys の言葉）を含むか。対象がなければ true
function labelNamesTargets(
  label: string,
  ops: ReplanChatLlm["options"][number]["ops"],
  beforeDays: readonly { items: PlannedItem[] }[],
): boolean {
  const items = beforeDays.flatMap((day) => day.items);
  const titles = ops
    .filter((entry) => entry.op === "postpone" || entry.op === "skip" || entry.op === "shorten")
    .map((entry) => items.find((item) => item.id === entry.item_id)?.title)
    .filter((title): title is string => title !== undefined);
  if (titles.length === 0) return true;
  const normalized = label.normalize("NFKC").toLowerCase();
  return titles.some((title) => taskKeys(title).some((key) => normalized.includes(key)));
}

export async function runReplanChatTurn(input: ChatTurnInput, deps: ChatTurnDeps): Promise<ReplanChatResponse> {
  if (!deps.emit) return runTurn(input, deps, null);
  const view = createReplanTurnView({
    emit: deps.emit,
    text: input.request.text,
    context: input.context,
    beforeDays: input.beforeDays,
    elapsedMs: deps.elapsedMs,
  });
  // turn_end は、どの return からでも1回だけ（例外のときは reply_type "error"）
  try {
    const response = await runTurn(input, deps, view);
    view.end(response);
    return response;
  } catch (e) {
    view.end(null);
    throw e;
  }
}

async function runTurn(input: ChatTurnInput, deps: ChatTurnDeps, view: ReplanTurnView | null): Promise<ReplanChatResponse> {
  const { request } = input;
  // 2. LLM_MODE=off → 12.2 の経路
  if (!deps.llmEnabled()) {
    view?.fallback("llm_off");
    return deps.fallback();
  }

  let context = input.context;
  let feedback: ReplanChatFeedback[] = [];
  // 最後に通らなかった案の理由のうち、利用者に見せてよいもの（Engine・Validator の理由は除く）
  let userReasons: string[] = [];
  // 出ている案がないのに select が返ってきて、やり直したか。awaitingRetry は、そのやり直しの返事をまだ受け取っていない間
  let selectRetried = false;
  let awaitingRetry = false;
  // これまでの試みで通らなかった案（やり直しの後に通った案で、外した日を説明に出すため）
  const attempts: FailedAttempt[] = [];

  for (let call = 0; call < MAX_PLAN_CALLS; call += 1) {
    // やり直しの前に、1ターンの上限を超えそうなら打ち切る（計画の呼び出し＋説明の最小の時間）
    if (call > 0 && deps.elapsedMs() + REPLAN_CHAT_TIMEOUT_MS + MIN_MESSAGE_TIMEOUT_MS > TURN_BUDGET_MS) break;

    // 3. 計画の呼び出し（12.13 ①）
    let llm: ReplanChatLlm;
    const llmStartedAt = view?.llmStart(call + 1, feedback.length) ?? 0;
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
      if (call === 0) {
        view?.fallback("llm_error");
        return deps.fallback();
      }
      break;
    }
    view?.llmResult(call + 1, llmStartedAt, llm);

    awaitingRetry = false;
    // 疲れは、今回の発言が疲れのキーワード（12.3.2）に当たるときだけ使う。当たらなければ LLM の fatigue は無視する
    const fatigue = mentionsFatigue(request.text) ? llm.fatigue : null;
    // 疲れ（high・medium）は reply_type に関係なく、今日のチェックインに入れる（12.2 の 6 と同じ。accept を待たない）
    if ((fatigue === "high" || fatigue === "medium") && context.checkin?.fatigue !== fatigue) {
      const previous = context;
      context = { ...context, checkin: await deps.updateFatigue(fatigue) };
      view?.stateUpdate(previous, context);
    }

    // 4. reply_type ごと
    switch (llm.reply_type) {
      case "chat":
        return reply(llm.text?.trim() || CHAT_DEFAULT_MESSAGE);
      case "question":
        return reply(llm.text?.trim() || QUESTION_DEFAULT_MESSAGE);
      case "select": {
        const id = llm.select_index !== null && llm.select_index >= 1 ? request.open_proposal_ids[llm.select_index - 1] : undefined;
        if (id) return reply(SELECT_MESSAGE(llm.select_index as number), { selected_proposal_id: id });
        // 出ている案がない・番号が範囲外 → select として扱わない。1回だけやり直す
        if (selectRetried || call + 1 >= MAX_PLAN_CALLS) return reply(SELECT_INVALID_QUESTION);
        selectRetried = true;
        awaitingRetry = true;
        feedback = [{ label: "", errors: [SELECT_INVALID_FEEDBACK] }];
        userReasons = [];
        view?.retry(call + 1, [SELECT_INVALID_FEEDBACK]);
        continue;
      }
      case "discard":
        await deps.discardProposals(request.open_proposal_ids);
        return reply(DISCARD_MESSAGE, { discarded: true });
      case "proposal":
        break;
    }

    // 5. 各案を検査する
    // 休憩・疲れの発言でなければ、tired_plan・add_rest を含む案は捨てる（全部捨てれば「案がない」の扱い）
    const options = llm.options.filter((option) => asksForRest(request.text) || !hasRestOp(option)).slice(0, 3);
    if (options.length === 0) {
      feedback = [{ label: "", errors: [NO_OPTIONS_ERROR] }];
      userReasons = [NO_OPTIONS_ERROR];
      if (call + 1 < MAX_PLAN_CALLS) view?.retry(call + 1, [NO_OPTIONS_ERROR]);
      continue;
    }
    const failedUserReasons: string[] = [];
    const passed: {
      label: string;
      tired: boolean;
      ops: ReplanChatLlm["options"][number]["ops"];
      check: Extract<ReturnType<typeof checkOption>, { ok: true }>;
    }[] = [];
    const failed: ReplanChatFeedback[] = [];
    options.forEach((option, i) => {
      const label = option.label.trim() || `案${i + 1}`;
      const check = checkOption({
        context,
        beforeDays: input.beforeDays,
        option: { label, ops: option.ops },
        fatigue,
        newId: deps.newId,
      });
      view?.optionCheck(call + 1, i + 1, label, context, check);
      if (check.ok) passed.push({ label, tired: isTiredPlan(option), ops: option.ops, check });
      else {
        // LLM にはすべての理由を返す。Engine・Validator の理由はログにだけ出し、利用者には見せない
        failed.push({ label, errors: check.errors });
        if (check.engineErrors.length > 0) logEngineFailure("replan-chat", check.engineErrors);
        const userErrors = check.errors.filter((error) => !check.engineErrors.includes(error));
        failedUserReasons.push(...userErrors);
        attempts.push({ ops: option.ops, errors: userErrors });
      }
    });

    // 外した op だけの案を検査し直し、利用者に見せてよい最初の理由を返す（droppedReasons）
    const recheck = (entry: ChatOp): string | null => {
      const result = checkOption({ context, beforeDays: input.beforeDays, option: { label: "", ops: [entry] }, fatigue, newId: deps.newId });
      return result.ok ? null : (result.errors.find((error) => !result.engineErrors.includes(error)) ?? null);
    };

    // 7. 通った案だけを保存して、説明を作る
    if (passed.length > 0) {
      const saved: SavedProposal[] = [];
      const facts: OptionFacts[] = [];
      for (const { label: llmLabel, tired, ops, check } of passed) {
        const rows = buildReplanRows({
          result: check.result,
          storedRows: input.storedRows,
          userId: input.userId,
          weeklyPlanId: input.weeklyPlanId,
          newId: deps.newId,
        });
        const optionFacts = buildOptionFacts({
          label: llmLabel,
          proposal: rows.proposal,
          warnings: check.warnings,
          tasks: context.tasks,
          newFixedEvents: check.newFixedEvents,
          newTasks: check.newTasks,
          dropped: call > 0 ? droppedReasons(ops, attempts, recheck, toDateStr(context.now)) : [],
        });
        // label が動かすタスクの名前を含まない（中身と違う）ときは、コードで作った要約の最初の文にする
        const label = labelNamesTargets(llmLabel, ops, input.beforeDays) ? llmLabel : (optionFacts.summary[0] ?? llmLabel);
        optionFacts.label = label;
        facts.push(optionFacts);
        // 会話の経路の intent（12.9 の互換の形）。tired_plan は Engine の intent のまま
        const intent = tired
          ? rows.proposal.intent
          : {
              type: "preference_change" as const,
              fatigue,
              task_changes: [],
              new_fixed_events: check.newFixedEvents,
              preference_changes: [label],
            };
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
          newTasks: check.newTasks,
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
    if (call + 1 < MAX_PLAN_CALLS) view?.retry(call + 1, failed.flatMap((entry) => entry.errors));
  }

  // 8. 最後まで通らない → できる範囲を伝える文。proposals は空。
  // 見せてよい理由がない（Engine・Validator の失敗だけ）ときは、決まった文を返す
  const reasons = [...new Set(userReasons)];
  // select のやり直しの前に時間切れになった
  if (awaitingRetry) return reply(SELECT_INVALID_QUESTION);
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
          await insertReplanProposal(
            supabase,
            buildProposalInsert(entry, {
              weeklyPlanId: active.id,
              date: today,
              userId,
              now: base.context.now, // getNow()（confirm_goal の tasks の created_at と同じ）
              version,
              expiresAt,
            }),
          );
        }
      },
      discardProposals: (ids) => discardReplanProposals(supabase, userId, today, ids),
      updateFatigue: (fatigue) => upsertCheckin(supabase, userId, today, { fatigue }),
      newId: () => crypto.randomUUID(),
      elapsedMs: () => performance.now() - startedAt,
      // ENGINE_VIEW=on のときだけ、発表用の別画面に出来事を流す
      ...(isEngineViewEnabled() ? { emit: createTurnEmitter(userId, "replan").emit } : {}),
    },
  );
}
