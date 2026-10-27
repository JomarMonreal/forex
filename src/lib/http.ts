/** fetch with a timeout and a couple of retries for flaky network errors (not HTTP errors). */
export async function fetchRetry(url: string, init: RequestInit & { timeoutMs?: number } = {}, retries = 2): Promise<Response> {
  const { timeoutMs = 15000, ...rest } = init;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, { cache: "no-store", ...rest, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      if (attempt >= retries) {
        throw new Error(`${err.message}${err.cause ? ` (${err.cause.code ?? err.cause.message})` : ""}`);
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}
