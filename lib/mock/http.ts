import { NextResponse, type NextRequest } from "next/server";

// ---------- 4章：モックAPI共通の待ち時間・エラー注入 ----------
// ?mock_error=1 の付いた画面からの呼び出しは、lib/api.ts（クライアント側）が
// リクエストヘッダー x-mock-error: 1 を付ける。Route Handler 側はそれを見て500を返す。

export function mockDelay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isMockError(request: NextRequest | Request): boolean {
  return request.headers.get("x-mock-error") === "1";
}

export function mockErrorResponse(): NextResponse {
  return NextResponse.json({ error: "モックエラー（?mock_error=1）" }, { status: 500 });
}
