import { cn } from "@/lib/utils";

// 右上の接続の状態

export type ConnectionBadgeState = "connecting" | "open" | "reconnecting" | "off";

const LABELS: Record<ConnectionBadgeState, string> = {
  connecting: "接続しています",
  open: "接続中",
  reconnecting: "つなぎ直し中",
  off: "ENGINE_VIEW が off",
};

export function ConnectionBadge({ state }: { state: ConnectionBadgeState }) {
  return (
    <span
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-full border bg-card px-3 py-1",
        state === "open" ? "border-[var(--kind-free)]" : "border-[var(--border)] text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-2.5 w-2.5 rounded-full",
          state === "open" && "bg-[var(--kind-free)]",
          (state === "connecting" || state === "reconnecting") && "animate-pulse bg-[var(--kind-fixed)]",
          state === "off" && "bg-[var(--purple-gray)]",
        )}
      />
      {LABELS[state]}
    </span>
  );
}
