import { Outfit } from "next/font/google";
import { CompassMark } from "./CompassMark";

// design-spec.md 5.7：ロゴだけの書体（推定）。本文・見出しの font-sans には混ぜない
const outfit = Outfit({
  weight: "700",
  subsets: ["latin"],
});

type LogoProps = {
  size?: number;
  className?: string;
};

/**
 * ロゴ「PURCHART」（design-spec.md 5.7）。
 * 「C」の中にコンパスを組み込む完全な再現はせず、指示のとおりテキストロゴ＋横に CompassMark で組む。
 */
export function Logo({ size = 28, className }: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <CompassMark size={size} />
      <span
        className={`${outfit.className} tracking-[0.08em] text-[var(--brand-dark)]`}
        style={{ fontSize: size * 0.7 }}
      >
        PURCHART
      </span>
    </div>
  );
}
