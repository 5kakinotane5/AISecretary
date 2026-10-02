import type { ReactNode } from "react";
import { Check, CircleAlert } from "lucide-react";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { formatDateShort } from "@/lib/datetime";
import { REPLAN_LABELS } from "@/lib/labels";
import { computeReplanImpact } from "@/lib/replan-impact";
import type { ReplanProposal, Task } from "@/lib/schemas";

type ReplanImpactProps = {
  proposal: ReplanProposal;
  /** GET /api/tasks の一覧。取れなかったら null（締切の行だけ出さない） */
  tasks: Task[] | null;
};

/**
 * /replan の「主な変更」（frontend.md 14.2）。AI の一文の下・ChangeList の上に置く。
 * 今日のタスク・自由時間（内部の buffer＋free）の増減、ほかの日に増えた分、締切に間に合うかを出す。0分の項目は出さない
 */
export function ReplanImpact({ proposal, tasks }: ReplanImpactProps) {
  const impact = computeReplanImpact(proposal, tasks ?? []);
  const { taskMinutesDelta, freeMinutesDelta } = impact.today;
  const todayParts = [
    taskMinutesDelta !== 0 ? `${REPLAN_LABELS.impactTask} ${REPLAN_LABELS.signedMinutes(taskMinutesDelta)}` : null,
    freeMinutesDelta !== 0 ? `${REPLAN_LABELS.impactFree} ${REPLAN_LABELS.signedMinutes(freeMinutesDelta)}` : null,
  ].filter((part): part is string => part !== null);

  return (
    <SurfaceCard className="flex flex-col gap-3">
      <h2 className="text-base font-bold">{REPLAN_LABELS.impactTitle}</h2>
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-sm tabular-nums">
        {todayParts.length > 0 ? (
          <Row label={REPLAN_LABELS.impactToday}>
            {/* 「自由時間 +135分」の途中で折り返さないよう、項目ごとにまとめる */}
            {todayParts.map((part, index) => (
              <span key={part} className="whitespace-nowrap">
                {index > 0 ? " ／ " : null}
                {part}
              </span>
            ))}
          </Row>
        ) : null}

        <Row label={REPLAN_LABELS.impactOtherDays}>
          {impact.otherDays.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {impact.otherDays.map((day) => (
                <li key={day.date} className="break-words">
                  {formatDateShort(day.date)} {REPLAN_LABELS.signedMinutes(day.minutes)}{" "}
                  {day.tasks.map((task) => task.title).join("、")}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">{REPLAN_LABELS.impactNoOtherDays}</span>
          )}
        </Row>

        {tasks ? (
          <Row label={REPLAN_LABELS.impactDeadline}>
            {impact.deadline.status === "late" ? (
              <span className="flex items-start gap-1.5 font-medium text-destructive">
                <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
                {REPLAN_LABELS.deadlineLate(impact.deadline.titles)}
              </span>
            ) : impact.deadline.status === "ok" ? (
              <span className="flex items-center gap-1.5">
                {REPLAN_LABELS.deadlineOk}
                <Check size={16} className="shrink-0 text-primary" aria-hidden />
              </span>
            ) : (
              <span className="text-muted-foreground">{REPLAN_LABELS.deadlineNoneMoved}</span>
            )}
          </Row>
        ) : null}
      </dl>
    </SurfaceCard>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-bold text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
