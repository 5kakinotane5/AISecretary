"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Columns2 } from "lucide-react";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { QuickReplies } from "@/components/chat/QuickReplies";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { MainShell } from "@/components/layout/MainShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { ChangeList } from "@/components/replan/ChangeList";
import { Timeline } from "@/components/timeline/Timeline";
import { Button } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import { acceptReplan, fetchClock, requestReplan } from "@/lib/api";
import { toDateStr } from "@/lib/datetime";
import { REPLAN_LABELS, REPLAN_QUICK_REPLIES, SCREEN_LABELS } from "@/lib/labels";
import type { ReplanProposal } from "@/lib/schemas";

type Message = { id: number; role: "user" | "assistant"; text: string };

/** 送信・確定の進み具合。error のときは lastText を再送できる */
type SendState = { status: "idle" } | { status: "sending" } | { status: "error"; lastText: string };

/**
 * /replan：AIとの対話（mock-spec.md 2.5、design-spec.md 6章）。
 * 開いたら GET /api/clock で現在時刻を読み、今日の計画を再調整する。
 * 「この計画にする」→ POST /api/plans/replan/accept → /today?updated=1。「やめておく」→ /today（何も変えない）。
 */
export default function ReplanPage() {
  const router = useRouter();
  const clock = useApiData(fetchClock, []);

  const [messages, setMessages] = useState<Message[]>([]);
  const [send, setSend] = useState<SendState>({ status: "idle" });
  const [proposal, setProposal] = useState<ReplanProposal | null>(null);
  const [comparing, setComparing] = useState(false);
  const [accepting, setAccepting] = useState<"idle" | "loading" | "error">("idle");
  const nextId = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const now = clock.status === "success" ? clock.data.now : null;

  // 新しい発言・結果が出たら、そこまでスクロールする
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, send.status, proposal]);

  function addMessage(role: Message["role"], text: string) {
    nextId.current += 1;
    const id = nextId.current;
    setMessages((prev) => [...prev, { id, role, text }]);
  }

  async function sendText(text: string, { echo = true }: { echo?: boolean } = {}) {
    if (!now) return;
    if (echo) addMessage("user", text);
    setSend({ status: "sending" });
    try {
      const response = await requestReplan(toDateStr(now), text);
      if ("supported" in response) {
        addMessage("assistant", response.message);
      } else {
        addMessage("assistant", response.summary_message);
        setProposal(response);
      }
      setSend({ status: "idle" });
    } catch {
      setSend({ status: "error", lastText: text });
    }
  }

  async function handleAccept() {
    if (!proposal) return;
    setAccepting("loading");
    try {
      await acceptReplan(proposal.proposal_id);
      router.push("/today?updated=1");
    } catch {
      setAccepting("error");
    }
  }

  const busy = send.status === "sending";

  let bottom = null;
  if (proposal) {
    bottom = (
      <div className="flex flex-col gap-2 rounded-t-[28px] border-t border-border/70 bg-card/95 px-4 pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(91,69,201,0.08)] backdrop-blur">
        {accepting === "error" ? (
          <ErrorState message={REPLAN_LABELS.acceptError} onRetry={handleAccept} className="py-2" />
        ) : null}
        <Button size="cta" onClick={handleAccept} disabled={accepting === "loading"}>
          {REPLAN_LABELS.accept}
        </Button>
        <Button variant="brand-text" size="tap" onClick={() => router.push("/today")}>
          {REPLAN_LABELS.cancel}
        </Button>
      </div>
    );
  } else if (now) {
    bottom = (
      <div className="rounded-t-[28px] border-t border-border/70 bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(91,69,201,0.08)] backdrop-blur">
        <ChatInput onSend={(text) => sendText(text)} disabled={busy} />
      </div>
    );
  }

  return (
    <MainShell bottom={bottom}>
      <PageHeader title={SCREEN_LABELS.replan} gradient="deep" />

      <div className="flex flex-col gap-4 px-3 py-4">
        {clock.status === "loading" ? <LoadingState rows={3} /> : null}
        {clock.status === "error" ? <ErrorState onRetry={clock.retry} /> : null}

        {now ? (
          <>
            <div className="flex flex-col gap-3 rounded-[28px] bg-card/70 p-3">
              <ChatBubble role="assistant">{REPLAN_LABELS.prompt}</ChatBubble>
              {messages.map((m) => (
                <ChatBubble key={m.id} role={m.role}>
                  {m.text}
                </ChatBubble>
              ))}

            {/* 最後の発言の下に出す。対応していない入力のあとも、選択肢から選び直せるようにする */}
            {!proposal && send.status === "idle" ? (
              <QuickReplies options={REPLAN_QUICK_REPLIES} onSelect={(text) => sendText(text)} />
            ) : null}

            {busy ? <LoadingState message={REPLAN_LABELS.adjusting} rows={2} /> : null}
            {send.status === "error" ? (
              <ErrorState
                message={REPLAN_LABELS.sendError}
                onRetry={() => sendText(send.lastText, { echo: false })}
              />
            ) : null}

            {proposal ? (
              <>
                <ChangeList proposal={proposal} />

                <Button
                  variant="brand-outline"
                  size="tap"
                  aria-pressed={comparing}
                  onClick={() => setComparing((v) => !v)}
                  className="self-start"
                >
                  <Columns2 aria-hidden />
                  {REPLAN_LABELS.compareToggle}
                </Button>
                {comparing ? (
                  <div className="grid grid-cols-2 gap-2">
                    <CompareColumn title={REPLAN_LABELS.before} items={proposal.before.items} />
                    <CompareColumn title={REPLAN_LABELS.after} items={proposal.after.items} />
                  </div>
                ) : null}
              </>
            ) : null}
            </div>
          </>
        ) : null}
        <div ref={endRef} />
      </div>
    </MainShell>
  );
}

/** 「変更前と変更後を並べて見る」の1本（幅が狭いので Timeline の簡略表示） */
function CompareColumn({ title, items }: { title: string; items: ReplanProposal["before"]["items"] }) {
  return (
    <SurfaceCard className="min-w-0 px-2 py-3">
      <h3 className="mb-2 text-center text-sm font-bold">{title}</h3>
      <Timeline items={items} compact />
    </SurfaceCard>
  );
}
