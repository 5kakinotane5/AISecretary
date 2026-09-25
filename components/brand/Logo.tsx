import { Outfit } from "next/font/google";
import { CompassMark } from "./CompassMark";

// design-spec.md 5.7：ロゴだけの書体（推定）。本文・見出しの font-sans には混ぜない
const outfit = Outfit({
  weight: "700",
  subsets: ["latin"],
});

type LogoProps = {
  size?: number;
  /** 文字色。dark＝明るい背景用（既定）、light＝スプラッシュなど暗い背景用 */
  tone?: "dark" | "light";
  /** 横の CompassMark を出すか。スプラッシュのように大きな CompassMark を別に置くときは false */
  withMark?: boolean;
  className?: string;
};

/**
 * ロゴ「PURCHART」（design-spec.md 5.7）。
 * 「C」の中にコンパスを組み込む完全な再現はせず、指示のとおりテキストロゴ＋横に CompassMark で組む。
 */
export function Logo({ size = 28, tone = "dark", withMark = true, className }: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {withMark ? <CompassMark size={size} /> : null}
      <span
        className={`${outfit.className} tracking-[0.08em] ${tone === "light" ? "text-white" : "text-[var(--brand-dark)]"}`}
        style={{ fontSize: size * 0.7 }}
      >
        PURCHART
      </span>
    </div>
  );
}
