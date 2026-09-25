"use client";

import { useState } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { DeadlineBadge } from "@/components/timeline/DeadlineBadge";
import { useApiData } from "@/hooks/use-api-data";
import { fetchTasks } from "@/lib/api";

// /dev/design の見本のうち、イベント処理が必要なもの（関数はサーバーコンポーネントから渡せないため分ける）

export function ChatInputSample() {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <div className="flex flex-col gap-3">
      {sent.map((text, i) => (
        <ChatBubble key={i} role="user">
          {text}
        </ChatBubble>
      ))}
      <ChatInput onSend={(text) => setSent((prev) => [...prev, text])} />
      <ChatInput onSend={() => {}} disabled placeholder="上の案から選んでください" />
    </div>
  );
}

export function ErrorStateSample() {
  const [retried, setRetried] = useState(0);
  return (
    <ErrorState
      message={retried === 0 ? "読み込みに失敗しました。" : `読み込みに失敗しました。（再試行 ${retried}回）`}
      onRetry={() => setRetried((n) => n + 1)}
    />
  );
}

/** 締切バッジの見本。締切の日付は GET /api/tasks から取る（ゼミレポート） */
export function DeadlineBadgeSample() {
  const result = useApiData(fetchTasks, []);
  if (result.status !== "success") return null;
  const deadlineAt = result.data.find((task) => task.id === "task_report")?.deadline_at;
  return deadlineAt ? <DeadlineBadge deadlineAt={deadlineAt} size="md" /> : null;
}
