import { Outfit } from "next/font/google";
import { CompassMark } from "./CompassMark";

// design-spec.md 5.7：ロゴだけの書体（推定）。本文・見出しの font-sans には混ぜない。
// 600 はスプラッシュ（tone="splash"）用。太さを2つ読むと className が font-weight を持たないので、各 tone で太さを指定する
const outfit = Outfit({
  weight: ["600", "700"],
  subsets: ["latin"],
});

type LogoProps = {
  size?: number;
  /** 文字色。dark＝明るい背景用（既定）、light＝暗い背景用、splash＝スプラッシュ（/login）用の細めで字間の広い組み */
  tone?: "dark" | "light" | "splash";
  /** 横の CompassMark を出すか。スプラッシュのように大きな CompassMark を別に置くときは false */
  withMark?: boolean;
  className?: string;
};

const TONE_CLASS: Record<NonNullable<LogoProps["tone"]>, string> = {
  dark: "font-bold tracking-[0.08em] text-[var(--brand-dark)]",
  light: "font-bold tracking-[0.08em] text-white",
  // 字間を広げた分、最後の字の後ろに残る字間を負のマージンで打ち消し、中央をそろえる
  splash: "font-semibold tracking-[0.24em] -mr-[0.24em] text-[#F4F1FF]",
};

/**
 * ロゴ「PURCHART」（design-spec.md 5.7）。
 * 「C」の中にコンパスを組み込む完全な再現はせず、指示のとおりテキストロゴ＋横に CompassMark で組む。
 */
export function Logo({ size = 28, tone = "dark", withMark = true, className }: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {withMark ? <CompassMark size={size} tone={tone === "splash" ? "splash" : "default"} /> : null}
      <span className={`${outfit.className} ${TONE_CLASS[tone]}`} style={{ fontSize: size * 0.7 }}>
        PURCHART
      </span>
    </div>
  );
}
