import { requireAuth } from "@/lib/auth";
import { subscribeAtlasEvents } from "@/lib/atlas-live-events";

export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function GET(request: Request) {
  await requireAuth();

  const encoder = new TextEncoder();
  let disposed = false;

  const stream = new ReadableStream({
    start(controller) {
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // ヘッダーは最初の enqueue まで flush されないため、即座にコメント行を
      // 送って接続確立（EventSource.onopen / connected 状態）を即時発火させる。
      controller.enqueue(encoder.encode(": connected\n\n"));

      const unsubscribe = subscribeAtlasEvents((event) => {
        if (disposed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      });

      const heartbeat = setInterval(() => {
        if (disposed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_INTERVAL_MS);

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
