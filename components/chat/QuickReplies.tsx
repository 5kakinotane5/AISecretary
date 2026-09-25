import { cn } from "@/lib/utils";

type QuickRepliesProps = {
  options: string[];
  /** タップした選択肢の文言を、ユーザーの発言として送る（mock-spec.md 2.2） */
  onSelect: (text: string) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * クイックリプライ（mock-spec.md 2.2・2.5）。AIの発言の直後に横並びで出す選択肢ボタン。
 * /interview と /replan で共通に使う（10.18章）。白の塗り・紫の文字と枠の角丸ピル型、高さ44px。
 */
export function QuickReplies({ options, onSelect, disabled = false, className }: QuickRepliesProps) {
  if (options.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2 pl-10", className)}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option)}
          className="min-h-11 rounded-full border border-primary bg-card px-4 py-2 text-left text-sm font-medium text-primary transition-colors outline-none hover:bg-[var(--brand-purple-pale)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
        >
          {option}
        </button>
      ))}
    </div>
  );
}
