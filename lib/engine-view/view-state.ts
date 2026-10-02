import type { Level, ObjectiveVector, PlanStyle } from "@/lib/schemas";
import type { DirectionDistances, EngineEvent, EngineEventSource, EngineSnapshotResponse, ParamSnapshot } from "./events";

// 発表用の別画面（/engine-view）の表示の状態。届いた出来事を1件ずつ applyEngineEvent で反映する（純粋関数）

export const STAGES: Record<EngineEventSource, readonly string[]> = {
  checkin: ["受付", "状態を更新", "パラメータを再計算", "完了"],
  replan: ["受付", "AIが読み取り", "状態を更新", "案を検査", "返事"],
};

export const STYLE_LABELS: Record<PlanStyle, string> = { intensive: "集中", balanced: "バランス", relaxed: "ゆとり" };
export const STYLE_ORDER = ["intensive", "balanced", "relaxed"] as const;

// F(S)・D_k の7成分（P6・P8.1）。画面の表記は「空き時間」
export const OBJECTIVE_AXES: readonly { key: keyof ObjectiveVector; label: string }[] = [
  { key: "achievement", label: "達成" },
  { key: "deadline_safety", label: "締切の安全" },
  { key: "task_fit", label: "適合" },
  { key: "buffer", label: "バッファ" },
  { key: "free_time", label: "空き時間" },
  { key: "control", label: "コントロール" },
  { key: "recovery", label: "回復" },
];

// 今日のビームの重み w_k の6成分（P5.4）
export const BEAM_WEIGHT_LABELS = ["w1 達成", "w2 適合", "w3 締切の安全", "w4 バッファ", "w5 空き時間", "w6 詰め込み"] as const;

export type OptionView = {
  call: number;
  index: number;
  label: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  changes: number;
  features: ObjectiveVector | null;
  distances: DirectionDistances | null;
};

// "idle"：まだ入力がなく、GET /api/debug/engine-snapshot の今の値を出している「待機中」のターン
export type TurnSource = EngineEventSource | "idle";

export type TurnView = {
  turnId: string;
  source: TurnSource;
  text: string;
  now: string;
  stage: number; // STAGES[source] の今の段階（待機中は -1）
  done: boolean;
  startSnapshot: ParamSnapshot; // turn_start の時点（①の「不明 → high」の起点）
  snapshot: ParamSnapshot; // 今の値
  beforeFeatures: ObjectiveVector | null; // 今の計画の F(S)
  beforeDistances: DirectionDistances | null;
  afterFeatures: ObjectiveVector | null; // 状態の更新後の、今の計画の F(S)（作り直していない）
  afterDistances: DirectionDistances | null; // afterFeatures と更新後の D_k との距離
  options: OptionView[];
  llmCalls: number;
  retries: number;
  fallback: "llm_off" | "llm_error" | null;
  replyType: string | null;
  proposals: number | null;
  elapsedMs: number;
};

export type LogLine = { seq: number; tMs: number; text: string };

export type ViewState = { turn: TurnView | null; previous: TurnView | null; log: LogLine[] };

export const INITIAL_VIEW_STATE: ViewState = { turn: null, previous: null, log: [] };

const LOG_LIMIT = 60;

export const levelText = (level: Level | null) => level ?? "不明";

const changedLevels = (before: ParamSnapshot, after: ParamSnapshot) =>
  (["fatigue", "concentration"] as const)
    .filter((field) => before.checkin[field] !== after.checkin[field])
    .map((field) => `${field === "fatigue" ? "疲れ" : "集中"} ${levelText(before.checkin[field])} → ${levelText(after.checkin[field])}`);

// ログに出す1行
export function describeEngineEvent(event: EngineEvent): string {
  switch (event.type) {
    case "turn_start":
      return event.source === "checkin" ? `受付（今日の調子）：${event.text}` : `受付（会話）：「${event.text}」`;
    case "llm_start":
      return `AIに問い合わせ（${event.call}回目${event.feedback_count > 0 ? `・直してほしい理由 ${event.feedback_count}件` : ""}）`;
    case "llm_result": {
      const ops = event.options.map((option) => `${option.label}［${option.ops.join("／")}］`).join("、");
      return `AIの読み取り：${event.reply_type}${event.fatigue ? `・疲れ ${event.fatigue}` : ""}（${(event.ms / 1000).toFixed(1)}秒）${ops ? `：${ops}` : ""}`;
    }
    case "state_update": {
      const changes = changedLevels(event.before, event.after);
      return `状態を更新：${changes.join("・") || "変化なし"} → D_k・w_k・Fit を再計算`;
    }
    case "option_check":
      return event.ok
        ? `案${event.index}「${event.label}」を検査：✔ 変更 ${event.changes}件${event.warnings.length > 0 ? `・注意 ${event.warnings.length}件` : ""}`
        : `案${event.index}「${event.label}」を検査：✕ ${event.errors[0] ?? "通りませんでした"}`;
    case "retry":
      return `やり直し（理由 ${event.reasons.length}件をAIに返す）`;
    case "fallback":
      return event.reason === "llm_off" ? "AIを使わない経路へ（LLM_MODE=off）" : "AIの呼び出しに失敗 → キーワードの経路へ";
    case "turn_end":
      if (event.reply_type === "error") return "エラーで終了";
      return event.source === "checkin" ? "完了" : `返事（${event.reply_type}・案 ${event.proposals}つ）`;
  }
}

function nextTurn(turn: TurnView, event: EngineEvent): TurnView {
  const base = { ...turn, elapsedMs: event.t_ms };
  const checkin = turn.source === "checkin";
  switch (event.type) {
    case "turn_start":
      return base;
    case "llm_start":
      return { ...base, stage: 1, llmCalls: event.call };
    case "llm_result":
      return { ...base, stage: 1, replyType: event.reply_type };
    case "state_update":
      return {
        ...base,
        stage: 2,
        snapshot: event.after,
        afterFeatures: event.after_features,
        afterDistances: event.after_distances,
      };
    case "option_check": {
      const option: OptionView = {
        call: event.call,
        index: event.index,
        label: event.label,
        ok: event.ok,
        errors: event.errors,
        warnings: event.warnings,
        changes: event.changes,
        features: event.after_features,
        distances: event.distances,
      };
      // 同じ番号の案は、やり直しの後の新しい方で置き換える
      const options = [...base.options.filter((entry) => entry.index !== event.index), option].sort((a, b) => a.index - b.index);
      return { ...base, stage: 3, options };
    }
    case "retry":
      return { ...base, stage: 3, retries: base.retries + 1 };
    case "fallback":
      return { ...base, stage: 1, fallback: event.reason };
    case "turn_end":
      return {
        ...base,
        stage: turn.source === "idle" ? turn.stage : STAGES[turn.source].length - 1,
        done: true,
        replyType: event.reply_type,
        proposals: checkin ? null : event.proposals,
      };
  }
}

export function applyEngineEvent(state: ViewState, event: EngineEvent): ViewState {
  const log = [...state.log, { seq: event.seq, tMs: event.t_ms, text: describeEngineEvent(event) }].slice(-LOG_LIMIT);
  if (event.type === "turn_start") {
    const turn: TurnView = {
      turnId: event.turn_id,
      source: event.source,
      text: event.text,
      now: event.now,
      stage: 0,
      done: false,
      startSnapshot: event.snapshot,
      snapshot: event.snapshot,
      beforeFeatures: event.before_features,
      beforeDistances: event.before_distances,
      afterFeatures: null,
      afterDistances: null,
      options: [],
      llmCalls: 0,
      retries: 0,
      fallback: null,
      replyType: null,
      proposals: null,
      elapsedMs: event.t_ms,
    };
    // 前のターンの値は、変化の起点として残す
    return { turn, previous: state.turn ?? state.previous, log };
  }
  // 途中から開いたなど、今のターンでない出来事はログにだけ出す
  if (!state.turn || state.turn.turnId !== event.turn_id) return { ...state, log };
  return { ...state, turn: nextTurn(state.turn, event), log };
}

// 待機中のターン（今の値）。入力はまだないので、①の起点も今の値（差分は出ない）。
// 次の turn_start で、ふつうのターンと同じく previous に移る
export function idleTurn(current: EngineSnapshotResponse, loadedAt: number): TurnView {
  return {
    turnId: `idle-${loadedAt}`,
    source: "idle",
    text: "",
    now: current.now,
    stage: -1,
    done: false,
    startSnapshot: current.snapshot,
    snapshot: current.snapshot,
    beforeFeatures: current.features,
    beforeDistances: current.distances,
    afterFeatures: null,
    afterDistances: null,
    options: [],
    llmCalls: 0,
    retries: 0,
    fallback: null,
    replyType: null,
    proposals: null,
    elapsedMs: 0,
  };
}

export type EngineViewAction =
  | { kind: "event"; event: EngineEvent }
  | { kind: "idle"; current: EngineSnapshotResponse; loadedAt: number };

// 画面の reducer。待機中の値は、今のターンを置き換える（前のターンは previous に残す）
export function engineViewReducer(state: ViewState, action: EngineViewAction): ViewState {
  if (action.kind === "event") return applyEngineEvent(state, action.event);
  return { ...state, turn: idleTurn(action.current, action.loadedAt), previous: state.turn ?? state.previous };
}

// 距離が一番小さい方向
export function nearestStyle(distances: DirectionDistances | null): PlanStyle | null {
  if (!distances) return null;
  return STYLE_ORDER.reduce((best, style) => (distances[style] < distances[best] ? style : best), STYLE_ORDER[0]);
}
