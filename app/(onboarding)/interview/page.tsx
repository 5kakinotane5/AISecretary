"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatBubble, ChatTypingBubble } from "@/components/chat/ChatBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { QuickReplies } from "@/components/chat/QuickReplies";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { GoalCandidateCard } from "@/components/interview/GoalCandidateCard";
import { MobileShell } from "@/components/layout/MobileShell";
import { OnboardingHeader } from "@/components/layout/OnboardingHeader";
import { Button } from "@/components/ui/button";
import { confirmInterview, generatePlans, sendInterviewMessage, startInterview } from "@/lib/api";
import { ONBOARDING_LABELS, formatGoalSelectionMessage } from "@/lib/labels";
import type { GoalPlanStyle, GoalTimeCandidate, InterviewTurn } from "@/lib/schemas";

/** ヒアリングのステップ数（mock-spec.md 5.7） */
const TOTAL_STEPS = 9;

/** チャットに積む1件。AI・ユーザーの吹き出しと、目標時間3案のカード */
type ChatEntry =
  | { kind: "message"; id: string; role: "ai" | "user"; text: string }
  | { kind: "candidates"; id: string; candidates: GoalTimeCandidate[] };

type StartState = { status: "loading" } | { status: "error" } | { status: "success"; turn: InterviewTurn };

function entriesOf(turn: InterviewTurn): ChatEntry[] {
  const messages: ChatEntry[] = turn.messages.map((m) => ({ kind: "message", id: m.id, role: m.role, text: m.text }));
  return turn.goal_candidates
    ? [...messages, { kind: "candidates", id: `${turn.session_id}-candidates`, candidates: turn.goal_candidates }]
    : messages;
}

/**
 * /interview：航海の準備（目的地を決める）（mock-spec.md 2.2・5.7・10.1〜10.3、design-spec.md 6章）。
 * - クイックリプライ・自由入力 → POST /api/interview/message（text）
 * - 目標時間3案 → 「これにする」→ ±0.5時間の調整 →「この内容で確定」→ POST /api/interview/message（selection）
 * - 最終確認の「確定する」→ POST /api/interview/confirm → 下部に「スケジュール作成」
 * - **「スケジュール作成」を押したときだけ** POST /api/plans/generate を呼び、/plans へ進む（確定だけでは生成しない）
 */
export default function InterviewPage() {
  const router = useRouter();

  // 開始（POST /api/interview/start）。開発時の StrictMode で effect が2回走っても、
  // セッションが2つ作られないように1回分の Promise を使い回す（useApiData では二重に呼ばれるため使わない）
  const startRef = useRef<Promise<InterviewTurn> | null>(null);
  const [startAttempt, setStartAttempt] = useState(0);
  const [start, setStart] = useState<StartState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    startRef.current ??= startInterview();
    startRef.current.then(
      (turn) => {
        if (!cancelled) setStart({ status: "success", turn });
      },
      () => {
        if (!cancelled) setStart({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [startAttempt]);

  function retryStart() {
    startRef.current = null;
    setStart({ status: "loading" });
    setStartAttempt((n) => n + 1);
  }

  const [laterEntries, setLaterEntries] = useState<ChatEntry[]>([]);
  const [latestTurn, setLatestTurn] = useState<InterviewTurn | null>(null);
  const [pending, setPending] = useState<"message" | "generate" | null>(null);
  const [failedTask, setFailedTask] = useState<(() => void) | null>(null);
  const [chosen, setChosen] = useState<{ style: GoalPlanStyle; hours: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const firstTurn = start.status === "success" ? start.turn : null;
  const turn = latestTurn ?? firstTurn;
  const entries = firstTurn ? [...entriesOf(firstTurn), ...laterEntries] : [];
  const sessionId = firstTurn?.session_id ?? null;

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length, pending, failedTask, confirmed]);

  /** API呼び出しを実行し、失敗したら同じ呼び出しをやり直せるように覚えておく */
  async function run(kind: "message" | "generate", task: () => Promise<void>) {
    setFailedTask(null);
    setPending(kind);
    try {
      await task();
    } catch {
      setFailedTask(() => () => void run(kind, task));
    } finally {
      setPending(null);
    }
  }

  function applyTurn(next: InterviewTurn) {
    setLaterEntries((prev) => [...prev, ...entriesOf(next)]);
    setLatestTurn(next);
  }

  function addUserMessage(text: string) {
    setLaterEntries((prev) => [...prev, { kind: "message", id: crypto.randomUUID(), role: "user", text }]);
  }

  function sendText(text: string) {
    if (!sessionId) return;
    addUserMessage(text);
    void run("message", async () => applyTurn(await sendInterviewMessage({ session_id: sessionId, text })));
  }

  function sendSelection() {
    if (!sessionId || !chosen) return;
    const selection = { style: chosen.style, hours_per_week: chosen.hours };
    addUserMessage(formatGoalSelectionMessage(selection.style, selection.hours_per_week));
    void run("message", async () => applyTurn(await sendInterviewMessage({ session_id: sessionId, selection })));
  }

  function confirmGoal() {
    if (!sessionId) return;
    void run("message", async () => {
      await confirmInterview(sessionId);
      setConfirmed(true);
    });
  }

  function createSchedule() {
    if (!sessionId) return;
    void run("generate", async () => {
      await generatePlans(sessionId);
      router.push("/plans");
    });
  }

  const step = turn?.step ?? null;
  const choosing = step === "goal_candidates";
  const confirming = step === "final_confirmation" && !confirmed;
  const busy = pending !== null;
  const canAct = !busy && failedTask === null;

  const inputPlaceholder = choosing
    ? ONBOARDING_LABELS.inputWhileChoosing
    : confirming
      ? ONBOARDING_LABELS.inputWhileConfirming
      : undefined;

  const bottom = confirmed ? (
    <div className="border-t bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <Button size="cta" onClick={createSchedule} disabled={busy}>
        {pending === "generate" ? ONBOARDING_LABELS.generating : ONBOARDING_LABELS.generatePlans}
      </Button>
    </div>
  ) : (
    <div className="px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <ChatInput
        onSend={sendText}
        disabled={!turn || busy || choosing || confirming}
        placeholder={inputPlaceholder}
      />
    </div>
  );

  return (
    <MobileShell bottom={bottom}>
      <OnboardingHeader
        title={ONBOARDING_LABELS.interviewTitle}
        backHref="/login"
        gradient="deep"
        progress={{ current: confirmed ? TOTAL_STEPS : (turn?.step_index ?? 0), total: TOTAL_STEPS }}
      />

      <div className="flex flex-col gap-3 px-4 py-4">
        {start.status === "loading" ? <ChatTypingBubble /> : null}
        {start.status === "error" ? <ErrorState onRetry={retryStart} /> : null}

        {entries.map((entry) =>
          entry.kind === "message" ? (
            <ChatBubble key={entry.id} role={entry.role === "ai" ? "assistant" : "user"}>
              {entry.text}
            </ChatBubble>
          ) : (
            <div key={entry.id} className="flex flex-col gap-3">
              {entry.candidates.map((candidate) => {
                const isChosen = chosen?.style === candidate.style;
                return (
                  <GoalCandidateCard
                    key={candidate.style}
                    candidate={candidate}
                    chosen={isChosen}
                    hours={isChosen ? chosen.hours : candidate.hours_per_week}
                    disabled={!choosing || !canAct}
                    onChoose={() => setChosen({ style: candidate.style, hours: candidate.hours_per_week })}
                    onHoursChange={(hours) => setChosen({ style: candidate.style, hours })}
                    onConfirm={sendSelection}
                  />
                );
              })}
            </div>
          ),
        )}

        {turn && canAct && !choosing && !confirming && !confirmed ? (
          <QuickReplies options={turn.quick_replies} onSelect={sendText} />
        ) : null}

        {confirming && canAct ? (
          <div className="pl-10">
            <Button size="tap" onClick={confirmGoal}>
              {ONBOARDING_LABELS.confirmGoal}
            </Button>
          </div>
        ) : null}

        {pending === "message" ? <ChatTypingBubble /> : null}
        {pending === "generate" ? <LoadingState message={ONBOARDING_LABELS.generating} rows={3} /> : null}
        {failedTask ? <ErrorState message="送信に失敗しました。" onRetry={failedTask} /> : null}

        <div ref={endRef} />
      </div>
    </MobileShell>
  );
}
