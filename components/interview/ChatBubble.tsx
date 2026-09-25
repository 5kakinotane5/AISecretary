import type { ReactNode } from "react";
import { Compass } from "lucide-react";
import { cn } from "@/lib/utils";

type ChatBubbleProps = {
  role: "user" | "assistant";
  children: ReactNode;
  className?: string;
};

/**
 * チャットの吹き出し（design-spec.md 5.5）。/interview と /replan で共通に使う。
 * - ユーザー：右寄せ、--brand-purple-pale の背景、角丸20px（右下だけ小さく）
 * - AI：左寄せ、白の背景、左にコンパスのアイコン（紫の丸の中に Compass）
 */
export function ChatBubble({ role, children, className }: ChatBubbleProps) {
  if (role === "user") {
    return (
      <div className={cn("flex justify-end", className)}>
        <div
          className="max-w-[80%] rounded-[20px] rounded-br-md px-4 py-2.5 text-base whitespace-pre-wrap"
          style={{ backgroundColor: "var(--brand-purple-pale)" }}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-start gap-2", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary" aria-hidden>
        <Compass size={16} className="text-primary-foreground" />
      </span>
      <div className="shadow-card max-w-[80%] rounded-[20px] rounded-bl-md bg-card px-4 py-2.5 text-base whitespace-pre-wrap">
        {children}
      </div>
    </div>
  );
}

/** AIの返答待ちの「…」（mock-spec.md 2.2） */
export function ChatTypingBubble() {
  return (
    <ChatBubble role="assistant">
      <span className="flex h-6 items-center gap-1" role="status" aria-label="入力中">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-bounce rounded-full"
            style={{ backgroundColor: "var(--brand-purple-light)", animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    </ChatBubble>
  );
}
