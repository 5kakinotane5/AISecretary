import { EmptyState } from "@/components/common/EmptyState";
import { MainShell } from "@/components/layout/MainShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { PLACEHOLDER_LABEL, SCREEN_LABELS } from "@/lib/labels";

// /calendar の仮ページ。タブを押しても404にならないように置く（本実装は mock-spec.md 8章ステップ7）
export default function CalendarPage() {
  return (
    <MainShell>
      <PageHeader title={SCREEN_LABELS.calendar} gradient="deep" />
      <EmptyState message={PLACEHOLDER_LABEL} />
    </MainShell>
  );
}
