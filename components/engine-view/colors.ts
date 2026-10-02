import type { PlanStyle } from "@/lib/schemas";

// 別画面の色。globals.css の変数（予定の種類・ブランドの色）から選ぶ

// 3方向（D_k）：集中＝固定予定の橙、バランス＝ブランドの紫、ゆとり＝空き時間の緑。text は白の上で読める濃さ
export const STYLE_COLORS: Record<PlanStyle, { line: string; text: string }> = {
  intensive: { line: "var(--kind-fixed)", text: "#b4531f" },
  balanced: { line: "var(--brand-purple)", text: "#5b45c9" },
  relaxed: { line: "var(--kind-free)", text: "#0f7a5f" },
};

// 今の計画（Before）
export const BEFORE_COLOR = "var(--purple-gray)";

// 案1〜3の After（方向の色と分ける）
export const OPTION_COLORS = ["#2e2170", "var(--kind-social)", "#0e7490"] as const;
