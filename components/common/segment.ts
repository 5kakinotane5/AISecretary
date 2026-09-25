// 角丸のピル型のセグメント（design-spec.md 6章：--brand-purple-pale の角丸のセグメント）。
// components/ui/tabs.tsx の TabsList・TabsTrigger の className に渡す。/plans の3案・曜日と /calendar の月／週／日で共用する
// 高さは、内側の余白（p-1）を除いたボタンの高さが44px（タップ領域の下限）になるように52pxにする。
// Tabs の外で使うとき（/settings のデモ時刻）は SEGMENT_LIST_STANDALONE を使う
export const SEGMENT_LIST = "w-full rounded-full bg-[var(--brand-purple-pale)] p-1 group-data-horizontal/tabs:h-[52px]";
export const SEGMENT_LIST_STANDALONE = "flex h-[52px] w-full rounded-full bg-[var(--brand-purple-pale)] p-1";
export const SEGMENT_TRIGGER =
  "h-full min-w-0 rounded-full text-sm font-bold text-primary/70 hover:text-primary data-active:bg-card data-active:text-primary data-active:shadow-sm";
