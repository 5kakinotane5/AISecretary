// 角丸のピル型のセグメント（design-spec.md 6章：--brand-purple-pale の角丸のセグメント）。
// components/ui/tabs.tsx の TabsList・TabsTrigger の className に渡す。/plans の3案・曜日と /calendar の月／週／日で共用する
export const SEGMENT_LIST = "w-full rounded-full bg-[var(--brand-purple-pale)] p-1 group-data-horizontal/tabs:h-12";
export const SEGMENT_TRIGGER =
  "h-full min-w-0 rounded-full text-sm font-bold text-primary/70 hover:text-primary data-active:bg-card data-active:text-primary data-active:shadow-sm";
