"use client";

import { useState, type FormEvent } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

type ChatInputProps = {
  onSend: (text: string) => void;
  /** 3案の選択中・最終確認中などで入力を止めるとき（mock-spec.md 10.3） */
  disabled?: boolean;
  /** 無効のときは「上の案から選んでください」などを出す */
  placeholder?: string;
  className?: string;
};

/**
 * チャットの入力欄（design-spec.md 5.5）。
 * 白、rounded-full、右に紫の丸い送信ボタン（ArrowUp）。文字は16px（iPhoneの自動ズーム防止。mock-spec.md 1.1）。
 */
export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "何でも話してみてください…",
  className,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const canSend = !disabled && text.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "shadow-card flex items-center gap-2 rounded-full border bg-card py-1 pr-1 pl-5 focus-within:border-ring",
        disabled && "opacity-60",
        className,
      )}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="メッセージ"
        className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        disabled={!canSend}
        aria-label="送信"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
      >
        <ArrowUp size={20} aria-hidden />
      </button>
    </form>
  );
}
