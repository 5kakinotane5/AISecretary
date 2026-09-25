import { SurfaceCard } from "@/components/common/SurfaceCard";
import { PLAN_STYLE_SHORT_LABELS, SCREEN_LABELS, formatHours } from "@/lib/labels";
import type { PlanSummary, ScheduleCandidate } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type PlanCompareTableProps = {
  candidates: ScheduleCandidate[];
  /** 選択中の案（その列を --brand-purple-pale で示す） */
  selectedId: string | null;
  /** 目標の task_name（GET /api/settings の goal）。目標の行の見出し「目的地（TOEIC学習）」に使う */
  goalName: string;
  className?: string;
};

/** どの案でも同じ行が同じ位置に来るよう、行の並びはここで固定する（mock-spec.md 2.3） */
function buildRows(goalName: string): { label: string; format: (s: PlanSummary) => string }[] {
  return [
    { label: "タスク", format: (s) => formatHours(s.task_hours) },
    { label: SCREEN_LABELS.buffer, format: (s) => formatHours(s.buffer_hours) },
    { label: "自由時間", format: (s) => formatHours(s.free_hours) },
    { label: "移動", format: (s) => formatHours(s.travel_hours) },
    { label: `${SCREEN_LABELS.goal}（${goalName}）`, format: (s) => formatHours(s.goal_hours) },
    { label: "締切タスク", format: (s) => `${s.deadline_task_count}件` },
  ];
}

/**
 * 航路プラン3案の比較表（mock-spec.md 2.3、design-spec.md 5.6・6章）。
 * 3案を横に並べ、行はタスク・余白・自由時間・移動・目的地（目標の task_name）・締切タスク。
 * 3案の違いを説明文だけにしないため、数値で並べて見せる。
 */
export function PlanCompareTable({ candidates, selectedId, goalName, className }: PlanCompareTableProps) {
  const rows = buildRows(goalName);
  return (
    <SurfaceCard className={cn("px-3 py-3", className)}>
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">航路プランの比較（1週間の合計）</caption>
        <thead>
          <tr>
            <th scope="col" className="w-[28%] py-2 text-left text-xs font-medium text-muted-foreground">
              週の合計
            </th>
            {candidates.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={cn(
                  "rounded-t-xl py-2 text-center font-bold",
                  c.id === selectedId ? "bg-[var(--brand-purple-pale)] text-primary" : "text-foreground",
                )}
              >
                {PLAN_STYLE_SHORT_LABELS[c.style]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.label} className="border-t">
              <th scope="row" className="py-2 text-left text-xs font-medium text-muted-foreground">
                {row.label}
              </th>
              {candidates.map((c) => (
                <td
                  key={c.id}
                  className={cn(
                    "py-2 text-center tabular-nums",
                    c.id === selectedId && "bg-[var(--brand-purple-pale)] font-bold",
                    c.id === selectedId && index === rows.length - 1 && "rounded-b-xl",
                  )}
                >
                  {row.format(c.summary)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </SurfaceCard>
  );
}
