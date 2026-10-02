import type { Level, ObjectiveVector, PlanStyle } from "@/lib/schemas";
import type { AdjustedDirections } from "@/lib/planning/select";

// 発表用の別画面（/engine-view）に流す「出来事」の型（サーバーの lib/server/engine-view と画面の components/engine-view の両方で使う）。
// 本番の動き（計画の結果・API の返事・DB）には使わない。ENGINE_VIEW=on のときだけ作る

export type EngineEventSource = "checkin" | "replan";

// 今日のタスク項目1つの Fit（P4）。画面に出すための値
export type FitRow = {
  item_id: string;
  title: string;
  start_at: string;
  end_at: string;
  high_concentration: boolean;
  duration_fit: number;
  time_of_day_fit: number;
  concentration_fit: number;
  fatigue_fit: number;
  interrupt_fit: number;
  split_fit: number;
  q: number;
  gate: 0 | 1;
  fit: number;
};

// その時点の Planning Engine のパラメータ（状態 s_t・D_k・今日のビームの w_k・今日のタスクの Fit）
export type ParamSnapshot = {
  checkin: { fatigue: Level | null; concentration: Level | null; mood: Level | null };
  directions: AdjustedDirections;
  beam_weights: Record<PlanStyle, number[]>; // 6成分（w1〜w6）
  today_fits: FitRow[];
};

export type DirectionDistances = Record<PlanStyle, number>;

type EventBody =
  | {
      type: "turn_start";
      text: string; // replan は発言、checkin は表示用の文
      now: string;
      snapshot: ParamSnapshot;
      before_features: ObjectiveVector | null;
      before_distances: DirectionDistances | null;
    }
  | { type: "llm_start"; call: number; feedback_count: number }
  | {
      type: "llm_result";
      call: number;
      ms: number;
      reply_type: string;
      fatigue: Level | null;
      options: { label: string; ops: string[] }[];
    }
  | {
      type: "state_update";
      before: ParamSnapshot;
      after: ParamSnapshot;
      after_distances: DirectionDistances | null; // 今の計画の F(S) と、更新後の D_k との距離
    }
  | {
      type: "option_check";
      call: number;
      index: number;
      label: string;
      ok: boolean;
      errors: string[];
      warnings: string[];
      changes: number;
      after_features: ObjectiveVector | null;
      distances: DirectionDistances | null;
    }
  | { type: "retry"; call: number; reasons: string[] }
  | { type: "fallback"; reason: "llm_off" | "llm_error" }
  | { type: "turn_end"; ms: number; reply_type: string; proposals: number; message: string };

type EventCommon = {
  seq: number; // bus が振る連番
  turn_id: string;
  user_id: string;
  source: EngineEventSource;
  t_ms: number; // ターンの始まりからの経過
};

export type EngineEvent = EventCommon & EventBody;
export type EngineEventType = EngineEvent["type"];

// 送る側が作る形（seq は bus が振る）
export type EngineEventInput = Omit<EventCommon, "seq"> & EventBody;

// 1ターンの中で使う emit（turn_id・user_id・source・t_ms は emit を作った側が入れる）
export type EngineEventPayload = EventBody;
export type EngineEmit = (event: EngineEventPayload) => void;
