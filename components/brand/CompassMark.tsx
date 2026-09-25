"use client";

import { useId } from "react";

type CompassMarkProps = {
  size?: number;
  className?: string;
};

/**
 * ロゴ・アプリアイコンの中心にある「円＋4方向に伸びる星」（design-spec.md 5.7）。
 * 星は白〜--brand-purple-pale のグラデーション、周りの円は細い線。
 */
export function CompassMark({ size = 48, className }: CompassMarkProps) {
  const gradientId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label="PURCHART"
    >
      <defs>
        <linearGradient id={gradientId} x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="var(--brand-purple-pale)" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="21" stroke="var(--brand-purple-light)" strokeWidth="1.5" />
      <path
        d="M24 5 L27.5 20.5 L43 24 L27.5 27.5 L24 43 L20.5 27.5 L5 24 L20.5 20.5 Z"
        fill={`url(#${gradientId})`}
      />
      <circle cx="24" cy="24" r="3" fill="var(--brand-purple)" />
    </svg>
  );
}
