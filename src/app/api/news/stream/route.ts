import { onNews, startPoller } from "@/lib/news/poller";

export const dynamic = "force-dynamic";

/** Server-Sent Events: pushes newly polled articles to the browser as they appear. */
export async function GET(req: Request) {
  startPoller();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("hello", { at: Date.now() });
      const off = onNews((items) => send("news", items));
      const ping = setInterval(() => controller.enqueue(encoder.encode(`: ping\n\n`)), 25000);
      cleanup = () => {
        off();
        clearInterval(ping);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
