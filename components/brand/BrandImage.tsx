import Image, { type ImageProps } from "next/image";
import type { ReactNode } from "react";
import { BRAND_IMAGES, type BrandImageKey } from "@/lib/brand";

type BrandImageProps = Omit<ImageProps, "src" | "alt"> & {
  imageKey: BrandImageKey;
  alt: string;
  /** 画像が未登録のときに代わりに表示するもの（省略時は何も出さない） */
  fallback?: ReactNode;
};

/**
 * lib/brand.ts の登録表を引いて画像を出す。未登録（null）の間は fallback を返す（design-spec.md 7章・9.1）。
 * 画像を差し込むときは lib/brand.ts にパスを登録するだけでよく、呼び出し側は変えない。
 */
export function BrandImage({ imageKey, alt, fallback = null, ...props }: BrandImageProps) {
  const src = BRAND_IMAGES[imageKey];
  if (!src) return <>{fallback}</>;
  return <Image src={src} alt={alt} {...props} />;
}
