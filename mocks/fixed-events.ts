import { z } from "zod";
import { FixedEventSchema } from "@/lib/schemas";
import { LOCATION_IDS } from "./persona";

// ---------- 5.6 固定予定（毎週）と生活の骨組み ----------
// 基準週は 2026-10-05（月）〜2026-10-11（日）。睡眠・移動はここには含めない
// （睡眠は UserPreference、移動は TravelTime とその日の予定から組み立てる）。
// 授業・バイトは「毎週同じ曜日・時刻に繰り返す」と明記されているため recurrence: "weekly"。
// 食事も同じ曜日なら毎週同じ時刻として recurrence: "weekly" にするが、
// 金曜の友人との夕食・日曜の家族との昼食はこの週限定の予定として recurrence: null にする。
export const FIXED_EVENTS = z.array(FixedEventSchema).parse([
  // 月曜 10/5
  { id: "fx_mon_breakfast", title: "朝食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-05T07:30:00+09:00", end_at: "2026-10-05T08:00:00+09:00", recurrence: "weekly" },
  { id: "fx_mon_lecture1", title: "1限 マクロ経済学", category: "class", location_id: LOCATION_IDS.univ, start_at: "2026-10-05T09:00:00+09:00", end_at: "2026-10-05T10:30:00+09:00", recurrence: "weekly" },
  { id: "fx_mon_lecture2", title: "2限 統計学", category: "class", location_id: LOCATION_IDS.univ, start_at: "2026-10-05T10:40:00+09:00", end_at: "2026-10-05T12:10:00+09:00", recurrence: "weekly" },
  { id: "fx_mon_lunch", title: "昼食", category: "meal", location_id: LOCATION_IDS.univ, start_at: "2026-10-05T12:10:00+09:00", end_at: "2026-10-05T13:00:00+09:00", recurrence: "weekly" },
  { id: "fx_mon_dinner", title: "夕食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-05T19:00:00+09:00", end_at: "2026-10-05T19:45:00+09:00", recurrence: "weekly" },

  // 火曜 10/6
  { id: "fx_tue_breakfast", title: "朝食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-06T07:30:00+09:00", end_at: "2026-10-06T08:00:00+09:00", recurrence: "weekly" },
  { id: "fx_tue_lunch", title: "昼食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-06T11:30:00+09:00", end_at: "2026-10-06T12:00:00+09:00", recurrence: "weekly" },
  { id: "fx_tue_lecture1", title: "3限 英語コミュニケーション", category: "class", location_id: LOCATION_IDS.univ, start_at: "2026-10-06T13:00:00+09:00", end_at: "2026-10-06T14:30:00+09:00", recurrence: "weekly" },
  { id: "fx_tue_lecture2", title: "4限 経営学", category: "class", location_id: LOCATION_IDS.univ, start_at: "2026-10-06T14:40:00+09:00", end_at: "2026-10-06T16:10:00+09:00", recurrence: "weekly" },
  { id: "fx_tue_work", title: "バイト（休憩・まかない含む）", category: "work", location_id: LOCATION_IDS.cafe, start_at: "2026-10-06T18:00:00+09:00", end_at: "2026-10-06T22:00:00+09:00", recurrence: "weekly" },
  { id: "fx_tue_dinner", title: "夕食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-06T22:15:00+09:00", end_at: "2026-10-06T22:45:00+09:00", recurrence: "weekly" },

  // 水曜 10/7
  { id: "fx_wed_breakfast", title: "朝食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-07T07:30:00+09:00", end_at: "2026-10-07T08:00:00+09:00", recurrence: "weekly" },
  { id: "fx_wed_lecture1", title: "2限 ミクロ経済学", category: "class", location_id: LOCATION_IDS.univ, start_at: "2026-10-07T10:40:00+09:00", end_at: "2026-10-07T12:10:00+09:00", recurrence: "weekly" },
  { id: "fx_wed_lunch", title: "昼食", category: "meal", location_id: LOCATION_IDS.univ, start_at: "2026-10-07T12:10:00+09:00", end_at: "2026-10-07T13:00:00+09:00", recurrence: "weekly" },
  { id: "fx_wed_seminar", title: "ゼミ", category: "class", location_id: LOCATION_IDS.univ, start_at: "2026-10-07T14:40:00+09:00", end_at: "2026-10-07T16:10:00+09:00", recurrence: "weekly" },
  { id: "fx_wed_dinner", title: "夕食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-07T19:00:00+09:00", end_at: "2026-10-07T19:45:00+09:00", recurrence: "weekly" },

  // 木曜 10/8
  { id: "fx_thu_breakfast", title: "朝食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-08T07:30:00+09:00", end_at: "2026-10-08T08:00:00+09:00", recurrence: "weekly" },
  { id: "fx_thu_lecture1", title: "1限 計量経済学", category: "class", location_id: LOCATION_IDS.univ, start_at: "2026-10-08T09:00:00+09:00", end_at: "2026-10-08T10:30:00+09:00", recurrence: "weekly" },
  { id: "fx_thu_lunch", title: "昼食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-08T12:00:00+09:00", end_at: "2026-10-08T12:45:00+09:00", recurrence: "weekly" },
  { id: "fx_thu_dinner", title: "夕食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-08T19:00:00+09:00", end_at: "2026-10-08T19:45:00+09:00", recurrence: "weekly" },

  // 金曜 10/9
  { id: "fx_fri_breakfast", title: "朝食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-09T07:30:00+09:00", end_at: "2026-10-09T08:00:00+09:00", recurrence: "weekly" },
  { id: "fx_fri_lecture1", title: "2限 統計学演習", category: "class", location_id: LOCATION_IDS.univ, start_at: "2026-10-09T10:40:00+09:00", end_at: "2026-10-09T12:10:00+09:00", recurrence: "weekly" },
  { id: "fx_fri_lunch", title: "昼食", category: "meal", location_id: LOCATION_IDS.univ, start_at: "2026-10-09T12:10:00+09:00", end_at: "2026-10-09T13:00:00+09:00", recurrence: "weekly" },
  { id: "fx_fri_lecture2", title: "3限 金融論", category: "class", location_id: LOCATION_IDS.univ, start_at: "2026-10-09T13:00:00+09:00", end_at: "2026-10-09T14:30:00+09:00", recurrence: "weekly" },
  { id: "fx_fri_social_dinner", title: "友人と夕食", category: "social", location_id: LOCATION_IDS.station, start_at: "2026-10-09T19:00:00+09:00", end_at: "2026-10-09T21:00:00+09:00", recurrence: null },

  // 土曜 10/10
  { id: "fx_sat_breakfast", title: "朝食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-10T07:30:00+09:00", end_at: "2026-10-10T08:00:00+09:00", recurrence: "weekly" },
  { id: "fx_sat_work", title: "バイト（休憩・まかない含む）", category: "work", location_id: LOCATION_IDS.cafe, start_at: "2026-10-10T10:00:00+09:00", end_at: "2026-10-10T15:00:00+09:00", recurrence: "weekly" },
  { id: "fx_sat_dinner", title: "夕食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-10T19:00:00+09:00", end_at: "2026-10-10T19:45:00+09:00", recurrence: "weekly" },

  // 日曜 10/11
  { id: "fx_sun_breakfast", title: "朝食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-11T07:30:00+09:00", end_at: "2026-10-11T08:00:00+09:00", recurrence: "weekly" },
  { id: "fx_sun_family_lunch", title: "家族と昼食", category: "family", location_id: LOCATION_IDS.home, start_at: "2026-10-11T12:00:00+09:00", end_at: "2026-10-11T13:30:00+09:00", recurrence: null },
  { id: "fx_sun_dinner", title: "夕食", category: "meal", location_id: LOCATION_IDS.home, start_at: "2026-10-11T19:00:00+09:00", end_at: "2026-10-11T19:45:00+09:00", recurrence: "weekly" },
]);
