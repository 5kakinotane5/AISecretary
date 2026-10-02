"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Columns2 } from "lucide-react";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { QuickReplies } from "@/components/chat/QuickReplies";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { SurfaceCard } from "@/components/common/SurfaceCard";
import { DemoNowChip } from "@/components/layout/DemoNowChip";
import { MainShell } from "@/components/layout/MainShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { ChangeList } from "@/components/replan/ChangeList";
import { ReplanImpact } from "@/components/replan/ReplanImpact";
import { Timeline } from "@/components/timeline/Timeline";
import { Button } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import { acceptReplan, ApiError, fetchDemoNow, fetchTasks, requestReplan, setDemoNow } from "@/lib/api";
import { toDateStr } from "@/lib/datetime";
import { REPLAN_LABELS, REPLAN_QUICK_REPLIES, SCREEN_LABELS } from "@/lib/labels";
import type { ReplanProposal } from "@/lib/schemas";

type Message = { id: number; role: "user" | "assistant"; text: string };

/**
 * 送信・確定の進み具合。error のときは lastText を再送できる。
 * needsPlan は有効な計画がない（INVALID_STATE）ときのサーバーの文言。再送しても通らないので「プランを選ぶ」を出す
 */
type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "error"; lastText: string; needsPlan: string | null };

/**
 * /replan：計画づくり（mock-spec.md 2.5・10.6・10.20、design-spec.md 6章・9.4）。
 * 開いたら GET /api/mock/clock で時刻を読み、18:00より前なら POST /api/mock/clock で18:00を明示して送る。
 * 「この計画にする」→ POST /api/plans/replan/accept → /today?updated=1。「やめておく」→ /today（何も変えない）。
 * /today の「AIに相談する」から /replan?text= で来たら、時刻の読み込みのあとにその文を1回だけ送る（frontend.md 14.2）。
 */
export default function ReplanPage() {
  const router = useRouter();
  // 開発時の Strict Mode では読み込みが2回走り、2回目は18:00以降になっているため、進めたことをここに残す
  const advancedRef = useRef(false);
  const clock = useApiData(async () => {
    const now = await fetchDemoNow();
    const eighteen = `${toDateStr(now)}T18:00:00+09:00`;
    if (now < eighteen) {
      advancedRef.current = true;
      return { now: await setDemoNow(eighteen), advanced: true };
    }
    return { now, advanced: advancedRef.current };
  }, []);

  const [messages, setMessages] = useState<Message[]>([]);
  const [send, setSend] = useState<SendState>({ status: "idle" });
  const [proposal, setProposal] = useState<ReplanProposal | null>(null);
  const [comparing, setComparing] = useState(false);
  const [accepting, setAccepting] = useState<"idle" | "loading" | "error">("idle");
  const nextId = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  // 最後の AI の吹き出しと、その頭までスクロールした返事の id
  const lastAssistantRef = useRef<HTMLDivElement>(null);
  const scrolledAssistantIdRef = useRef<number | null>(null);
  // ?text= を送ったか。Strict Mode で effect が2回走っても1回だけ送る
  const queryTextSentRef = useRef(false);

  const now = clock.status === "success" ? clock.data.now : null;
  // 「主な変更」のタスク名・締切に使う。取れなかったら締切の行だけ出さない（frontend.md 14.2）
  const tasksResult = useApiData(fetchTasks, []);
  const tasks = tasksResult.status === "success" ? tasksResult.data : null;

  // スクロール（frontend.md 14.2）：
  // - AI の返事が来たら、その吹き出しの頭を画面の上に合わせる（下の「主な変更」・変更の詳細・ボタンは利用者が自分でスクロールして見る）
  // - 利用者の発言・読み込み中・エラーのときは、一番下までスクロールする
  // 同じ返事に2回合わせない（「並べて見る」などで再描画しても戻さない）
  useEffect(() => {
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    const last = messages.at(-1);
    if (last?.role === "assistant" && send.status === "idle") {
      if (scrolledAssistantIdRef.current === last.id) return;
      scrolledAssistantIdRef.current = last.id;
      lastAssistantRef.current?.scrollIntoView({ behavior, block: "start" });
      return;
    }
    endRef.current?.scrollIntoView({ behavior, block: "end" });
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
    } catch (error) {
      const needsPlan = error instanceof ApiError && error.code === "INVALID_STATE" ? error.message : null;
      setSend({ status: "error", lastText: text, needsPlan });
    }
  }

  function sendQueryText(text: string) {
    if (queryTextSentRef.current) return;
    queryTextSentRef.current = true;
    // クエリを消して、再読み込みで再送しないようにする
    router.replace("/replan");
    void sendText(text);
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
      <div className="flex flex-col gap-2 border-t bg-card px-4 pt-3 pb-3">
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
      <div className="border-t bg-background px-4 pt-3 pb-3">
        <ChatInput onSend={(text) => sendText(text)} disabled={busy} />
      </div>
    );
  }

  return (
    <MainShell bottom={bottom}>
      <PageHeader title={SCREEN_LABELS.replan} gradient="deep" trailing={now ? <DemoNowChip now={now} /> : null} />
      {clock.status === "success" && clock.data.advanced ? (
        <p className="px-4 pt-2 text-xs text-muted-foreground">{REPLAN_LABELS.advancedClock}</p>
      ) : null}

      <div className="flex flex-col gap-4 px-4 py-4">
        {clock.status === "loading" ? <LoadingState rows={3} /> : null}
        {clock.status === "error" ? <ErrorState onRetry={clock.retry} /> : null}

        {now ? (
          <>
            {/* useSearchParams を使う部分は Suspense で囲む（Next.js の use-search-params.md「Prerendering」） */}
            <Suspense fallback={null}>
              <QueryTextSender onText={sendQueryText} />
            </Suspense>
            <ChatBubble role="assistant">{REPLAN_LABELS.prompt}</ChatBubble>
            {messages.map((m, index) => (
              // 最後の AI の返事は、頭に合わせてスクロールする（上に12pxの余白）
              <div
                key={m.id}
                ref={m.role === "assistant" && index === messages.length - 1 ? lastAssistantRef : undefined}
                className="scroll-mt-3"
              >
                <ChatBubble role={m.role}>{m.text}</ChatBubble>
              </div>
            ))}

            {/* 最後の発言の下に出す。対応していない入力のあとも、選択肢から選び直せるようにする */}
            {!proposal && send.status === "idle" ? (
              <QuickReplies options={REPLAN_QUICK_REPLIES} onSelect={(text) => sendText(text)} />
            ) : null}

            {busy ? <LoadingState message={REPLAN_LABELS.adjusting} rows={2} /> : null}
            {send.status === "error" && send.needsPlan !== null ? (
              <div className="flex flex-col items-center">
                <ErrorState message={send.needsPlan} className="pb-4" />
                <Button variant="brand-outline" size="tap" onClick={() => router.push("/plans")}>
                  {REPLAN_LABELS.choosePlan}
                </Button>
              </div>
            ) : null}
            {send.status === "error" && send.needsPlan === null ? (
              <ErrorState
                message={REPLAN_LABELS.sendError}
                onRetry={() => sendText(send.lastText, { echo: false })}
              />
            ) : null}

            {proposal ? (
              <>
                <ReplanImpact proposal={proposal} tasks={tasks} />
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
          </>
        ) : null}
        <div ref={endRef} />
      </div>
    </MainShell>
  );
}

/** 視差効果を減らす設定（prefers-reduced-motion: reduce）のとき true。そのときはスクロールを smooth にしない */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * /replan?text= の文を onText に渡す。時刻の読み込みが成功してから描画される（送る前に18:00への繰り上げを済ませる）。
 * 1回だけ送ることとクエリを消すことは onText の側で行う
 */
function QueryTextSender({ onText }: { onText: (text: string) => void }) {
  const text = useSearchParams().get("text");

  useEffect(() => {
    if (text) onText(text);
  }, [text, onText]);

  return null;
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
