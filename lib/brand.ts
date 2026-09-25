/**
 * 画像素材の登録表（design-spec.md 7章・9.1）。
 * 画像は `public/brand/` に置き、用意でき次第ここに実際のパスを登録すると BrandImage から使われるようになる。
 * 画像がない間はすべて null にし、CSSグラデーションと CompassMark だけで画面を成立させる。
 */
export type BrandImageKey = "appIcon" | "splashSea";

export const BRAND_IMAGES: Record<BrandImageKey, string | null> = {
  appIcon: null, // 用意でき次第 "/brand/app-icon.png" を登録する
  splashSea: null, // 用意でき次第 "/brand/splash-sea.png" を登録する
};
