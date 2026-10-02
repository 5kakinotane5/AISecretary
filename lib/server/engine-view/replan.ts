import { formatMonthDay } from "@/lib/datetime";
import type { PlannedItem, PlanningContext, ReplanChatLlm, ReplanChatResponse } from "@/lib/schemas";
import type { CheckOptionResult } from "@/lib/server/replan-chat/check";
import type { EngineEmit } from "@/lib/engine-view/events";
import { buildParamSnapshot, computeFeatures, directionDistances } from "./snapshot";

// 会話の再計画の1ターン（lib/server/replan-chat/run.ts）を、発表用の別画面に流す。
// run.ts は deps.emit があるときだけこれを作る。どの関数も例外を外に投げない（本番の処理を止めない）

type Days = { date: string; items: PlannedItem[] }[];
type LlmOption = ReplanChatLlm["options"][number];
type LlmOp = LlmOption["ops"][number];

const safe = (fn: () => void) => {
  try {
    fn();
  } catch {
    // 何もしない
  }
};

// 操作を短い文字列にする（「postpone ES作成」「add_event 飲み会 18:00〜19:00」）
export function formatOp(entry: LlmOp, beforeDays: readonly Days[number][]): string {
  const title = (id: string | null) =>
    beforeDays.flatMap((day) => day.items).find((item) => item.id === id)?.title ?? id ?? "?";
  const range = () => {
    const start = entry.start ?? "?";
    if (entry.end) return `${start}〜${entry.end}`;
    return entry.minutes !== null ? `${start}〜（${entry.minutes}分）` : start;
  };
  const words: (string | null)[] = (() => {
    switch (entry.op) {
      case "add_event":
        return [entry.title, entry.repeat === "weekly" ? `毎週${entry.weekday ?? ""}` : entry.date ? formatMonthDay(entry.date) : null, range()];
      case "add_rest":
        return [entry.title, range()];
      case "delay":
        return [entry.minutes !== null ? `${entry.minutes}分` : null];
      case "reorder":
        return [entry.item_ids.map(title).join("→")];
      case "shorten":
        return [title(entry.item_id), entry.minutes !== null ? `${entry.minutes}分` : null];
      case "postpone":
      case "move_to_day":
        return [title(entry.item_id), entry.date ? formatMonthDay(entry.date) : null];
      case "skip":
        return [title(entry.item_id)];
      case "pull_forward":
        return [title(entry.item_id), entry.position];
      case "add_task":
        return [entry.title, entry.deadline_date ? `締切${formatMonthDay(entry.deadline_date)}` : null, entry.minutes !== null ? `${entry.minutes}分` : null];
      default:
        return [entry.title, entry.item_id ? title(entry.item_id) : null];
    }
  })();
  return [entry.op, ...words.filter((word): word is string => !!word)].join(" ");
}

export type ReplanTurnView = ReturnType<typeof createReplanTurnView>;

export function createReplanTurnView(input: {
  emit: EngineEmit;
  text: string;
  context: PlanningContext;
  beforeDays: Days;
  elapsedMs: () => number;
}) {
  const { emit, beforeDays } = input;
  let replyType = "error";
  let ended = false;
  safe(() => {
    const snapshot = buildParamSnapshot(input.context, beforeDays);
    const beforeFeatures = computeFeatures(input.context, beforeDays);
    emit({
      type: "turn_start",
      text: input.text,
      now: input.context.now,
      snapshot,
      before_features: beforeFeatures,
      before_distances: directionDistances(beforeFeatures, snapshot.directions),
    });
  });

  return {
    fallback(reason: "llm_off" | "llm_error") {
      replyType = "fallback";
      safe(() => emit({ type: "fallback", reason }));
    },
    llmStart(call: number, feedbackCount: number): number {
      const startedAt = input.elapsedMs();
      safe(() => emit({ type: "llm_start", call, feedback_count: feedbackCount }));
      return startedAt;
    },
    llmResult(call: number, startedAt: number, llm: ReplanChatLlm) {
      replyType = llm.reply_type;
      safe(() =>
        emit({
          type: "llm_result",
          call,
          ms: Math.round(input.elapsedMs() - startedAt),
          reply_type: llm.reply_type,
          fatigue: llm.fatigue,
          options: llm.options.map((option) => ({
            label: option.label,
            ops: option.ops.map((entry) => formatOp(entry, beforeDays)),
          })),
        }),
      );
    },
    stateUpdate(before: PlanningContext, after: PlanningContext) {
      safe(() => {
        const afterSnapshot = buildParamSnapshot(after, beforeDays);
        const afterFeatures = computeFeatures(after, beforeDays);
        emit({
          type: "state_update",
          before: buildParamSnapshot(before, beforeDays),
          after: afterSnapshot,
          after_features: afterFeatures,
          after_distances: directionDistances(afterFeatures, afterSnapshot.directions),
        });
      });
    },
    optionCheck(call: number, index: number, label: string, context: PlanningContext, check: CheckOptionResult) {
      safe(() => {
        if (!check.ok) {
          emit({ type: "option_check", call, index, label, ok: false, errors: check.errors, warnings: [], changes: 0, after_features: null, distances: null });
          return;
        }
        // After の7日分：updated_days を Before に重ねたもの（check.ts と同じ作り方）。足した予定・タスクも context に入れる
        const updated = new Map(check.result.updated_days.map((day) => [day.date, day]));
        const afterDays = beforeDays.map((day) => updated.get(day.date) ?? day);
        const afterContext: PlanningContext = {
          ...context,
          tasks: [...context.tasks, ...check.newTasks],
          fixed_events: [...context.fixed_events, ...check.newFixedEvents],
        };
        const features = computeFeatures(afterContext, afterDays);
        const { directions } = buildParamSnapshot(context, null);
        emit({
          type: "option_check",
          call,
          index,
          label,
          ok: true,
          errors: [],
          warnings: check.warnings,
          changes: check.result.proposal.changes.length + check.result.proposal.other_day_changes.length,
          after_features: features,
          distances: directionDistances(features, directions),
        });
      });
    },
    retry(call: number, reasons: string[]) {
      safe(() => emit({ type: "retry", call, reasons: [...new Set(reasons)] }));
    },
    // 返事を返すとき（1ターンに1回だけ）
    end(response: ReplanChatResponse | null) {
      if (ended) return;
      ended = true;
      safe(() =>
        emit({
          type: "turn_end",
          ms: Math.round(input.elapsedMs()),
          reply_type: response === null ? "error" : response.source === "fallback" ? "fallback" : replyType,
          proposals: response?.proposals.length ?? 0,
          message: response?.message ?? "",
        }),
      );
    },
  };
}
