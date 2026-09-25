import { CircleCheck } from "lucide-react";

type FlashNoticeProps = {
  message: string;
  visible: boolean;
};

/**
 * ページ上部に数秒だけ重ねて出す小さな通知（mock-spec.md 10.7・10.20：パッケージを増やさずトーストの代わりにする）。
 * 本文のスクロール領域の先頭に置く。高さ0の sticky の中に重ねるので、本文の位置はずれない。
 * 出す・消すの時間は呼び出し側が決める。
 */
export function FlashNotice({ message, visible }: FlashNoticeProps) {
  return (
    <div className="pointer-events-none sticky top-0 z-20 h-0">
      <div role="status" aria-live="polite" className="absolute inset-x-4 top-3 flex justify-center">
        {visible ? (
          <p className="shadow-card flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-bold text-primary">
            <CircleCheck size={16} aria-hidden />
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
