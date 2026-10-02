"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CompassMark } from "@/components/brand/CompassMark";
import { Logo } from "@/components/brand/Logo";
import { MobileShell } from "@/components/layout/MobileShell";
import { Button } from "@/components/ui/button";
import { mockLogin } from "@/lib/api";
import { ONBOARDING_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

/**
 * /login：スプラッシュ（mock-spec.md 2.1・10.11、design-spec.md 6章）。
 * メールアドレス欄はなく、白い主ボタン「START」→ POST /api/auth/mock-login → /interview。
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
      {/* 背景は1枚の連続したグラデーション（深い藍）。重ねの境目の線が出ないよう、光や水平線の層は重ねない */}
      <div className="relative flex min-h-full flex-col overflow-hidden text-white" style={{ background: SPLASH_BACKGROUND }}>
        <div className="pointer-events-none absolute inset-0 opacity-[0.03]" style={{ backgroundImage: SPLASH_NOISE }} aria-hidden />

        <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-6 pt-16 text-center">
          <div className={cn("relative", FADE_UP)}>
            {/* ロゴの後ろにだけ置く、ごく薄い光（半径はロゴの約2倍） */}
            <div
              className="pointer-events-none absolute top-1/2 left-1/2 size-[544px] -translate-x-1/2 -translate-y-1/2"
              style={{ background: "radial-gradient(circle closest-side, rgba(139, 124, 246, 0.15), transparent)" }}
              aria-hidden
            />
            <CompassMark size={136} tone="splash" className="relative" />
          </div>
          {/* アプリ名〜コピーの間隔（24px）を、細い線の上下に半分ずつ分ける */}
          <div className="flex flex-col items-center gap-3">
            <Logo size={46} tone="splash" withMark={false} className={cn(FADE_UP, "delay-80")} />
            <div className={cn("h-px w-6 bg-white/25", FADE_UP, "delay-80")} aria-hidden />
            <div className={cn("flex flex-col gap-1", FADE_UP, "delay-160")}>
              {/* 句読点だけが次の行に落ちないよう、各行は折り返さない */}
              <p className="text-base font-medium tracking-[0.04em] whitespace-nowrap text-white/88">
                {ONBOARDING_LABELS.tagline}
              </p>
              <p className="text-xs tracking-[0.06em] whitespace-nowrap text-white/50">{ONBOARDING_LABELS.taglineEn}</p>
            </div>
          </div>
        </div>

        <div className={cn("relative flex flex-col gap-3 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]", FADE_UP, "delay-240")}>
          {status === "error" ? (
            <p role="alert" className="rounded-2xl bg-white/90 px-4 py-2 text-center text-sm font-medium text-destructive">
              ログインに失敗しました。もう一度お試しください。
            </p>
          ) : null}
          <Button
            size="cta"
            className="border-transparent bg-[#F4F1FF] font-semibold tracking-[0.2em] text-[#1C1A36] shadow-none hover:bg-[#F4F1FF] hover:opacity-92 active:bg-[#E6E1FA] focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-[#B9A8F5] focus-visible:ring-offset-2 focus-visible:ring-offset-[#9FB0F2]"
            onClick={handleStart}
            disabled={status === "loading"}
          >
            {/* 字間を広げた分、最後の字の後ろの余りを打ち消して中央をそろえる */}
            <span className="-mr-[0.2em]">
              {status === "loading" ? "準備しています…" : status === "error" ? "再試行" : ONBOARDING_LABELS.start}
            </span>
          </Button>
        </div>
      </div>
    </MobileShell>
  );
}

/** スプラッシュの背景（夜空の藍 → 紫と水色の間の青紫 → 下端の淡い青紫）。このページだけで使う */
const SPLASH_BACKGROUND = "linear-gradient(180deg, #0F172A 0%, #2A2A6E 45%, #5A64C8 75%, #9FB0F2 100%)";

/** ごく薄いノイズ（SVG の feTurbulence を背景に埋め込む。画像ファイルは使わない） */
const SPLASH_NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** 表示時に下から 8px ふわっと出す（500ms）。順番は呼び出し側の delay-* で付ける。動きを減らす設定では動かさない */
const FADE_UP = "animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both motion-reduce:animate-none";
