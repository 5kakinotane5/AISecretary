import { ChevronDown } from "lucide-react";
import { SuggestionCard } from "@/components/common/SuggestionCard";
import { formatDateShort, formatTimeRange } from "@/lib/datetime";
import { CHANGE_TYPE_LABELS, REPLAN_LABELS, getItemAppearance } from "@/lib/labels";
import type { ReplanChange, ReplanProposal, ScheduleItem } from "@/lib/schemas";

type ChangeListProps = {
  proposal: ReplanProposal;
};

/**
 * 再計画の変更点（mock-spec.md 2.5、design-spec.md 5.6・6章：「今日のおすすめ航路」風のカード）。
 * - 変更された項目だけを「変更前（取り消し線）→ 変更後」で出し、理由を添える
 * - 「変更なし ◯件」は折りたたみ。開くと変更のない項目の一覧
 * - 「ほかの日への影響」は other_day_changes（10/7・10/8 に移した内容）
 */
export function ChangeList({ proposal }: ChangeListProps) {
  const changedIds = new Set(proposal.changes.flatMap((c) => (c.before ? [c.before.id] : [])));
  const unchanged = proposal.before.items.filter((item) => !changedIds.has(item.id));

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold">{REPLAN_LABELS.changesTitle}</h2>
        {proposal.changes.map((change, index) => (
          <ChangeCard key={change.before?.id ?? `change-${index}`} change={change} />
        ))}

        {unchanged.length > 0 ? (
          <details className="group shadow-card rounded-3xl bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-3xl px-4 text-sm font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {REPLAN_LABELS.unchanged(unchanged.length)}
              <ChevronDown size={18} className="text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="flex flex-col gap-1 px-4 pb-4 text-sm text-muted-foreground">
              {unchanged.map((item) => (
                <li key={item.id} className="tabular-nums">
                  {itemText(item)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {proposal.other_day_changes.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-bold">{REPLAN_LABELS.otherDaysTitle}</h2>
          {proposal.other_day_changes.map((change, index) => (
            <ChangeCard key={change.after[0]?.id ?? `other-${index}`} change={change} showDate />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ChangeCard({ change, showDate = false }: { change: ReplanChange; showDate?: boolean }) {
  const { label, icon } = CHANGE_TYPE_LABELS[change.change_type];
  const date = change.moved_to_date ?? change.after[0]?.start_at ?? null;

  return (
    <SuggestionCard
      icon={icon}
      title={showDate && date ? `${formatDateShort(date)} ${label}` : label}
      description={change.reason}
    >
      <div className="flex flex-col gap-1 rounded-2xl bg-muted px-3 py-2 text-sm tabular-nums">
        {change.before ? (
          <p className="text-muted-foreground line-through decoration-1">
            <span className="sr-only">{REPLAN_LABELS.before}：</span>
            {itemText(change.before)}
          </p>
        ) : null}
        <p className="flex items-start gap-1.5">
          <span aria-hidden className="text-primary">
            →
          </span>
          <span className="sr-only">{REPLAN_LABELS.after}：</span>
          <span className="flex flex-col">
            {change.after.length > 0
              ? change.after.map((item) => <span key={item.id}>{itemText(item)}</span>)
              : afterNoneText(change)}
          </span>
        </p>
      </div>
    </SuggestionCard>
  );
}

/** 「18:00–19:00 TOEIC リスニング演習」。内部の「バッファ」は「余白」と表示する（design-spec.md 4章） */
function itemText(item: ScheduleItem): string {
  const title = item.kind === "buffer" ? getItemAppearance(item.kind).label : item.title;
  return `${formatTimeRange(item.start_at, item.end_at)} ${title}`;
}

/** 変更後がないとき：「なし（10/7へ）」または「なし」 */
function afterNoneText(change: ReplanChange): string {
  return change.moved_to_date
    ? `${REPLAN_LABELS.none}（${formatDateShort(change.moved_to_date)}へ）`
    : REPLAN_LABELS.none;
}
