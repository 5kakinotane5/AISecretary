import { z } from "zod";
import { LocationSchema, TravelTimeSchema, UserPreferenceSchema } from "@/lib/schemas";

// ---------- 5.1 ペルソナ ----------
// LocationSchema・UserPreferenceSchema には無い、デモ用の人物設定（`POST /api/auth/mock-login` の display_name などで使う）
export const PERSONA_DISPLAY_NAME = "佐藤 ひかり";
export const PERSONA_AFFILIATION = "架空大学 経済学部 3年";

export const USER_PREFERENCE = UserPreferenceSchema.parse({
  sleep_start: "00:00",
  sleep_end: "07:30",
  daily_work_limit_minutes: 360,
  min_buffer_minutes: 15,
  min_daily_buffer_minutes: 60,
});

// ---------- 5.2 場所 ----------
export const LOCATION_IDS = {
  home: "loc_home",
  univ: "loc_univ",
  cafe: "loc_cafe",
  station: "loc_station",
} as const;

export const LOCATIONS = z.array(LocationSchema).parse([
  {
    id: LOCATION_IDS.home,
    name: "自宅",
    address: "東京都ひばり市みどり町2-4-1 ひばりハイツ203",
    kind: "home",
  },
  {
    id: LOCATION_IDS.univ,
    name: "架空大学 つばさキャンパス",
    address: "東京都つばさ市おおぞら1-1",
    kind: "university",
  },
  {
    id: LOCATION_IDS.cafe,
    name: "カフェ・ソレイユ ひばり駅前店（バイト先）",
    address: "東京都ひばり市さくら通り3-8",
    kind: "work",
  },
  {
    id: LOCATION_IDS.station,
    name: "ひばり駅前（飲食店）",
    address: "東京都ひばり市さくら通り周辺",
    kind: "other",
  },
]);

// ---------- 5.3 移動時間表（双方向とも同じ時間で、両方向の行を入れる） ----------
export const TRAVEL_TIMES = z.array(TravelTimeSchema).parse([
  { from_location_id: LOCATION_IDS.home, to_location_id: LOCATION_IDS.univ, minutes: 50, mode: "walk_train", note: "徒歩10分＋電車35分＋徒歩5分" },
  { from_location_id: LOCATION_IDS.univ, to_location_id: LOCATION_IDS.home, minutes: 50, mode: "walk_train", note: "徒歩10分＋電車35分＋徒歩5分" },
  { from_location_id: LOCATION_IDS.univ, to_location_id: LOCATION_IDS.cafe, minutes: 35, mode: "walk_train", note: null },
  { from_location_id: LOCATION_IDS.cafe, to_location_id: LOCATION_IDS.univ, minutes: 35, mode: "walk_train", note: null },
  { from_location_id: LOCATION_IDS.univ, to_location_id: LOCATION_IDS.station, minutes: 35, mode: "walk_train", note: null },
  { from_location_id: LOCATION_IDS.station, to_location_id: LOCATION_IDS.univ, minutes: 35, mode: "walk_train", note: null },
  { from_location_id: LOCATION_IDS.home, to_location_id: LOCATION_IDS.cafe, minutes: 12, mode: "walk", note: null },
  { from_location_id: LOCATION_IDS.cafe, to_location_id: LOCATION_IDS.home, minutes: 12, mode: "walk", note: null },
  { from_location_id: LOCATION_IDS.home, to_location_id: LOCATION_IDS.station, minutes: 12, mode: "walk", note: null },
  { from_location_id: LOCATION_IDS.station, to_location_id: LOCATION_IDS.home, minutes: 12, mode: "walk", note: null },
  { from_location_id: LOCATION_IDS.cafe, to_location_id: LOCATION_IDS.station, minutes: 3, mode: "walk", note: null },
  { from_location_id: LOCATION_IDS.station, to_location_id: LOCATION_IDS.cafe, minutes: 3, mode: "walk", note: null },
]);
