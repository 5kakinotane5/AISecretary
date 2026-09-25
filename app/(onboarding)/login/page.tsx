"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrandImage } from "@/components/brand/BrandImage";
import { CompassMark } from "@/components/brand/CompassMark";
import { Logo } from "@/components/brand/Logo";
import { MobileShell } from "@/components/layout/MobileShell";
import { Button } from "@/components/ui/button";
import { mockLogin } from "@/lib/api";
import { ONBOARDING_LABELS } from "@/lib/labels";

/**
 * /login：スプラッシュ（mock-spec.md 2.1・10.11、design-spec.md 6章）。
 * メールアドレス欄はなく、白い主ボタン「はじめる」→ POST /api/auth/mock-login → /interview。
 * 画面全体をスプラッシュにするため、主ボタンは MobileShell の bottom ではなく本文の下端に置く（本文はスクロールしない）。
 */
export default function LoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleStart() {
    setStatus("loading");
    try {
      await mockLogin();
      router.push("/interview");
    } catch {
      setStatus("error");
    }
  }

  return (
    <MobileShell>
      <div className="relative flex min-h-full flex-col overflow-hidden text-white" style={{ background: "var(--gradient-night)" }}>
        {/* 下端の水平線と海の光。画像（public/brand/）があればそちらを使う（design-spec.md 7章・9.1） */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%]" aria-hidden>
          <BrandImage
            imageKey="splashSea"
            alt=""
            fill
            sizes="390px"
            className="object-cover"
            fallback={
              <>
                <div className="absolute inset-0" style={{ background: "var(--splash-sea-glow)" }} />
                <div className="absolute inset-x-0 top-0 h-px" style={{ background: "var(--splash-horizon)" }} />
              </>
            }
          />
        </div>

        <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-6 pt-16 text-center">
          <CompassMark size={120} />
          <Logo size={40} tone="light" withMark={false} />
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium">{ONBOARDING_LABELS.tagline}</p>
            <p className="text-sm opacity-80">{ONBOARDING_LABELS.taglineEn}</p>
          </div>
        </div>

        <div className="relative flex flex-col gap-3 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
          {status === "error" ? (
            <p role="alert" className="rounded-2xl bg-white/90 px-4 py-2 text-center text-sm font-medium text-destructive">
              ログインに失敗しました。もう一度お試しください。
            </p>
          ) : null}
          <Button
            variant="brand-outline"
            size="cta"
            className="border-white"
            onClick={handleStart}
            disabled={status === "loading"}
          >
            {status === "loading" ? "準備しています…" : status === "error" ? "再試行" : ONBOARDING_LABELS.start}
          </Button>
        </div>
      </div>
    </MobileShell>
  );
}
