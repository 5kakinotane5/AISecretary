import { toDateStr } from "@/lib/datetime";
import { CHECKIN_LABELS } from "@/lib/labels";
import type { DailyCheckin, Level, PlannedItem, PlanningContext } from "@/lib/schemas";
import type { EngineEmit } from "@/lib/engine-view/events";
import { buildParamSnapshot, computeFeatures, directionDistances } from "./snapshot";

// POST /api/checkin の「決定」を、発表用の別画面に流す（turn_start → state_update → turn_end）。
// 保存そのものと API の返事は今まで通り。出来事の計算に失敗しても保存は止めない

export type EngineViewBase = {
  context: PlanningContext; // 保存の前の今日のチェックインが入った context
  days: { date: string; items: PlannedItem[] }[] | null; // 有効な計画の7日分（ない日は null）
};

export type CheckinEngineView = {
  load: () => Promise<EngineViewBase>;
  emit: EngineEmit;
  elapsedMs: () => number;
};

type CheckinValues = Partial<Record<"mood" | "fatigue" | "concentration", Level | null>>;

// 表示用の文（「疲労：疲れている・集中：ふつう・気分：落ち込み気味」）。送った項目だけ
export function checkinText(values: CheckinValues): string {
  const parts = (["fatigue", "concentration", "mood"] as const).flatMap((field) => {
    const value = values[field];
    if (value === undefined) return [];
    const { label, options } = CHECKIN_LABELS.fields[field];
    return [`${label}：${value === null ? "未選択" : options[value]}`];
  });
  return parts.join("・");
}

// view が null（ENGINE_VIEW が on でない）なら save を呼ぶだけ（context も作らない）
export async function saveCheckinWithEngineView(
  values: CheckinValues,
  save: () => Promise<DailyCheckin>,
  view: CheckinEngineView | null,
): Promise<DailyCheckin> {
  if (!view) return save();

  // 保存の前：今の状態と、今の計画の F(S)・D_k との距離
  let base: EngineViewBase | null = null;
  let before: ReturnType<typeof buildParamSnapshot> | null = null;
  let features: ReturnType<typeof computeFeatures> = null;
  try {
    base = await view.load();
    before = buildParamSnapshot(base.context, base.days);
    features = computeFeatures(base.context, base.days);
    view.emit({
      type: "turn_start",
      text: checkinText(values),
      now: base.context.now,
      snapshot: before,
      before_features: features,
      before_distances: directionDistances(features, before.directions),
    });
  } catch {
    base = null;
  }

  const saved = await save();

  if (base && before) {
    try {
      // 保存の後：保存した値を入れた context（今日の分のときだけ。今日以外の日は状態に使わない）
      const today = toDateStr(base.context.now);
      const context = saved.date === today ? { ...base.context, checkin: saved } : base.context;
      const after = buildParamSnapshot(context, base.days);
      if (
        after.checkin.fatigue !== before.checkin.fatigue ||
        after.checkin.concentration !== before.checkin.concentration
      ) {
        view.emit({
          type: "state_update",
          before,
          after,
          after_distances: directionDistances(features, after.directions),
        });
      }
      view.emit({ type: "turn_end", ms: view.elapsedMs(), reply_type: "checkin", proposals: 0, message: "" });
    } catch {
      // 何もしない
    }
  }
  return saved;
}
