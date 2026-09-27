import { ReplanChangeSchema, type ReplanChange, type ScheduleItem } from "@/lib/schemas";

export type ReplanChangeScope = "today" | "other";

function key(change: ReplanChange): string {
  return JSON.stringify([change.change_type, change.before?.id ?? null, change.after.map((item) => item.id), change.moved_to_date, change.reason]);
}

function start(change: ReplanChange): string {
  return change.before?.start_at ?? change.after[0]?.start_at ?? "";
}

/** 12.5: 再計画操作と同時に変更を記録する。 */
export class ReplanDiffBuilder {
  private readonly today: ReplanChange[] = [];
  private readonly other: ReplanChange[] = [];

  record(scope: ReplanChangeScope, value: {
    change_type: ReplanChange["change_type"];
    before: ScheduleItem | null;
    after?: readonly ScheduleItem[];
    moved_to_date?: string | null;
    reason: string;
  }): void {
    const parsed = ReplanChangeSchema.parse({ ...value, after: value.after ?? [], moved_to_date: value.moved_to_date ?? null });
    const target = scope === "today" ? this.today : this.other;
    if (!target.some((entry) => key(entry) === key(parsed))) target.push(parsed);
  }

  build(): { changes: ReplanChange[]; other_day_changes: ReplanChange[] } {
    return {
      changes: [...this.today].sort((a, b) => start(a).localeCompare(start(b)) || key(a).localeCompare(key(b))),
      other_day_changes: [...this.other].sort((a, b) => (a.moved_to_date ?? "").localeCompare(b.moved_to_date ?? "") || start(a).localeCompare(start(b)) || key(a).localeCompare(key(b))),
    };
  }
}
