// Starts the background news poller as soon as the Next.js server boots.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("./lib/news/poller");
    startPoller();
  }
}
