import { formatDemoChip } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** ヘッダー右上のデモ時刻「デモ 07:00」。半透明の白い角丸のチップ（design-spec.md 9.4） */
export function DemoNowChip({ now, className }: { now: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white tabular-nums",
        className,
      )}
    >
      {formatDemoChip(now)}
    </span>
  );
}
