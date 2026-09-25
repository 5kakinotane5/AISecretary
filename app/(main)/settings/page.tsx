import { EmptyState } from "@/components/common/EmptyState";
import { MainShell } from "@/components/layout/MainShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { PLACEHOLDER_LABEL, SETTINGS_TITLE } from "@/lib/labels";

// /settings の仮ページ。タブを押しても404にならないように置く（本実装は mock-spec.md 8章ステップ8）
export default function SettingsPage() {
  return (
    <MainShell>
      <PageHeader title={SETTINGS_TITLE} gradient="header" />
      <EmptyState message={PLACEHOLDER_LABEL} />
    </MainShell>
  );
}
