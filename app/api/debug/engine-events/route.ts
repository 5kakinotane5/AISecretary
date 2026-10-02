import type { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { isEngineViewEnabled, subscribe } from "@/lib/server/engine-view/bus";

// GET /api/debug/engine-events?after=<seq>（発表用。ENGINE_VIEW=on のときだけ）：
// ログイン中の利用者の Planning Engine の出来事を SSE で流す。after があれば、それより後のバッファ分から
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_MS = 15_000;

export async function GET(request: NextRequest) {
  return handle(request, async () => {
    if (!isEngineViewEnabled()) throw new HttpError(404, "NOT_FOUND", "見つかりません");
    const { user } = await requireUser();
    const after = Number(request.nextUrl.searchParams.get("after") ?? "0");
    const afterSeq = Number.isFinite(after) ? after : 0;

    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };
        const unsubscribe = subscribe(user.id, afterSeq, (event) => send(`data: ${JSON.stringify(event)}\n\n`));
        const ping = setInterval(() => send(": ping\n\n"), PING_MS);
        cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(ping);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // すでに閉じている
          }
        };
        request.signal.addEventListener("abort", () => cleanup(), { once: true });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}
