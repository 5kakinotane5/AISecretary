import type { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { isEngineViewEnabled, subscribe } from "@/lib/server/engine-view/bus";

// GET /api/debug/engine-events?after=<seq>（発表用。ENGINE_VIEW=on のときだけ）：
// ログイン中の利用者の Planning Engine の出来事を SSE で流す。after があれば、それより後のバッファ分から（なければ新しい分だけ）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_MS = 15_000;

export async function GET(request: NextRequest) {
  return handle(request, async () => {
    if (!isEngineViewEnabled()) throw new HttpError(404, "NOT_FOUND", "見つかりません");
    const { user } = await requireUser();
    // after がなければバッファは流さず、新しい出来事だけ（画面を開いた瞬間に過去の分を流さない）。
    // つなぎ直しのときは、画面が最後に受け取った seq を after に付ける
    const raw = request.nextUrl.searchParams.get("after");
    const after = raw === null ? Number.POSITIVE_INFINITY : Number(raw);
    const afterSeq = Number.isNaN(after) ? Number.POSITIVE_INFINITY : after;

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
        // すぐに1行送る（何も送らないと、最初の ping まで画面の EventSource の onopen が来ず、今の値を読み始められない）
        send(": connected\n\n");
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
