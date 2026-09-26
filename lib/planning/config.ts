import type { ObjectiveVector, PlanStyle } from "@/lib/schemas";

/** docs/design/planning.md P12 の初期値。調整はまだ行わない。 */
export const CONFIG = {
  comfortableTaskMinutes: 240,
  // P3.1・P3.2
  allocationGrid: {
    rho: [0.3, 0.45, 0.85],
    kappa: [0, 0.35, 1.0],
    goalOrder: ["early", "free_desc"],
  },
  optionalMaxPerDay: 120,
  // P4.2: Duration, TimeOfDay, Concentration, Fatigue, Interrupt, Split の順。
  fitWeights: [0.15, 0.25, 0.2, 0.2, 0.1, 0.1],
  lastDayFitFloor: 0.3, // P4.1: 締切の最終日にだけ使う。
  // P5.2・P5.3（単位: 分）
  lengths: [30, 45, 60, 75, 90, 105, 120],
  bufferOptions: [15, 30],
  freeOptions: [30, 60],
  headBufferMinGap: 45,
  headBuffer: 15,
  beam: { width: 30, maxSteps: 60 },
  // P5.4: [w1 Ach, w2 Fit, w3 DS, w4 Buf, w5 Free, w6 Over]。
  // P8.1 の7次元ベクトルとは成分数・順序が異なる。
  beamWeights: {
    intensive: [1.0, 0.6, 1.0, 0.3, 0.2, 0.2],
    balanced: [0.75, 0.85, 0.8, 0.7, 0.65, 0.7],
    relaxed: [0.55, 0.8, 0.6, 0.95, 0.9, 1.0],
  },
  penaltyPerHour: 10,
  // P8.1: A = intensive、B = balanced、C = relaxed。
  // ObjectiveVector の既存キーを使い、成分の取り違えを防ぐ。
  directions: {
    intensive: {
      achievement: 1.0,
      deadline_safety: 1.0,
      task_fit: 0.6,
      buffer: 0.3,
      free_time: 0.2,
      control: 0.7,
      recovery: 0.2,
    },
    balanced: {
      achievement: 0.75,
      deadline_safety: 0.8,
      task_fit: 0.85,
      buffer: 0.7,
      free_time: 0.65,
      control: 0.9,
      recovery: 0.7,
    },
    relaxed: {
      achievement: 0.55,
      deadline_safety: 0.6,
      task_fit: 0.8,
      buffer: 0.95,
      free_time: 0.9,
      control: 0.9,
      recovery: 1.0,
    },
  } satisfies Record<PlanStyle, ObjectiveVector>,
  diversity: { minDistance: 0.12, lambdaF: 0.5, lambdaS: 0.5 },
  // P9.1: 方向と今日のビームに加算し、結果を0〜1に収める。
  // beamWeights の補正も上記の6成分順。補正がない成分は0。
  stateAdjust: {
    fatigueHigh: {
      direction: {
        recovery: 0.15,
        free_time: 0.1,
        achievement: -0.1,
      } satisfies Partial<ObjectiveVector>,
      beamWeights: [0, 0, 0, 0, 0.1, 0.2],
    },
    concentrationLow: {
      direction: { task_fit: 0.1 } satisfies Partial<ObjectiveVector>,
      beamWeights: [0, 0.1, 0, 0, 0, 0],
    },
    deadlineNear: {
      maxDays: 2,
      direction: { deadline_safety: 0.1 } satisfies Partial<ObjectiveVector>,
      beamWeights: [0, 0, 0.1, 0, 0, 0],
    },
  },
  learning: { eta: 0.03, clip: 0.3 }, // P9.2（学習処理は今回実装しない）
  // docs/design/plans-replan.md 12.4（単位: 分。shorten_ratio のみ比率）
  replan: {
    buffer_minutes: 15,
    time_step_minutes: 5,
    tired_rest_minutes: 30,
    tired_light_max_minutes: 20,
    tired_light_min_minutes: 10,
    tired_light_buffer_min_minutes: 10,
    new_event_min_free_minutes: 60,
    shorten_ratio: 0.5,
    shorten_min_minutes: 30,
  },
} as const;
