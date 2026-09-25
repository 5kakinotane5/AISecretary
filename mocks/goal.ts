import { GoalSchema } from "@/lib/schemas";

// ---------- 5.4 目標（G1：ヒアリングで確定する内容） ----------
export const GOAL = GoalSchema.parse({
  id: "goal_toeic",
  task_name: "TOEIC学習",
  category: "資格・テスト勉強",
  target_hours_per_week: 6,
  frequency: null,
  deadline: "2026-12-13",
  priority: "medium",
  conditions: ["平日は夜が中心", "現在600点、目標730点", "リスニングが苦手"],
  user_selected_plan: "balanced",
});
