import "server-only";
import { jsonrepair } from "jsonrepair";

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/**
 * Resolve which free (non-Claude) model to use. Any OpenAI-compatible endpoint works;
 * the first provider with credentials configured wins.
 */
export function getLlmConfig(): LlmConfig | null {
  const env = process.env;
  if (env.LLM_BASE_URL) {
    return { provider: "custom", baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL ?? "llama3.1", apiKey: env.LLM_API_KEY };
  }
  if (env.GROQ_API_KEY) {
    return { provider: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: env.LLM_MODEL ?? "llama-3.3-70b-versatile", apiKey: env.GROQ_API_KEY };
  }
  if (env.GEMINI_API_KEY) {
    return { provider: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: env.LLM_MODEL ?? "gemini-2.5-flash", apiKey: env.GEMINI_API_KEY };
  }
  if (env.OPENROUTER_API_KEY) {
    return { provider: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: env.LLM_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free", apiKey: env.OPENROUTER_API_KEY };
  }
  if (env.OLLAMA_MODEL) {
    return { provider: "Ollama (local)", baseUrl: env.OLLAMA_URL ?? "http://localhost:11434/v1", model: env.OLLAMA_MODEL };
  }
  // Zero-config default: Pollinations' anonymous tier serves open-weights GPT-OSS 20B, no key needed.
  if (env.DISABLE_KEYLESS_LLM !== "1") {
    return { provider: "Pollinations (keyless)", baseUrl: "https://text.pollinations.ai/openai", model: env.LLM_MODEL ?? "openai" };
  }
  return null;
}

export async function chatJson<T>(cfg: LlmConfig, system: string, user: string): Promise<T> {
  const base = cfg.baseUrl.replace(/\/$/, "");
  // Pollinations exposes the chat endpoint at the base URL itself.
  const url = base.endsWith("/openai") && base.includes("pollinations") ? base : `${base}/chat/completions`;
  const call = (jsonMode: boolean) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(90000),
    });
  let res = await call(true);
  // Not every provider/model supports JSON mode — retry without it.
  if (res.status === 400) res = await call(false);
  if (!res.ok) throw new Error(`${cfg.provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  // Models sometimes wrap JSON in prose or ```json fences — grab the outermost object.
  const start = content.indexOf("{"), end = content.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`${cfg.provider} returned no JSON`);
  const raw = content.slice(start, end + 1);
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Small models often emit stray quotes or trailing commas.
    return JSON.parse(jsonrepair(raw)) as T;
  }
}
