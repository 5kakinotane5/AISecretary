import { z } from "zod";
import { GoalTimeCandidateSchema } from "@/lib/schemas";

// ---------- 5.8 目標時間3案（基準値は週6時間） ----------
export const GOAL_TIME_CANDIDATES = z.array(GoalTimeCandidateSchema).parse([
  {
    style: "intensive",
    label: "短期集中型",
    hours_per_week: 9,
    expected_load: "high",
    period_weeks: 10,
    characteristics: "毎日まとまった時間を確保",
    merit: "目標点に余裕を持って届きやすい",
    caution: "バイトのある火・土は負担が大きくなりやすい",
    reason: "130点アップを確実にしたい場合の目安です",
  },
  {
    style: "balanced",
    label: "バランス標準型",
    hours_per_week: 6,
    expected_load: "medium",
    period_weeks: 10,
    characteristics: "平日夜を中心に週5日ほど",
    merit: "授業・就活と両立しやすい",
    caution: "苦手なリスニングは早めに重点化が必要",
    reason: "10週間で130点アップを目指す標準的な目安です",
  },
  {
    style: "paced",
    label: "マイペース型",
    hours_per_week: 3,
    expected_load: "low",
    period_weeks: 10,
    characteristics: "空き時間に少しずつ",
    merit: "負担が小さく続けやすい",
    caution: "目標点には追加の学習が必要になる可能性があります",
    reason: "忙しい時期でも途切れずに続けたい場合の目安です",
  },
]);
