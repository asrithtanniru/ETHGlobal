/** Any OpenAI-compatible chat endpoint. A second provider is one more entry in the list. */
export interface LlmEndpoint {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ChatRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

const GROQ_URL = "https://api.groq.com/openai/v1";
const GROQ_MODEL = "qwen/qwen3.8-27b";
const TIMEOUT_MS = 15_000;

/** One endpoint per key, tried in the order given. */
export function groqEndpoints(keys: string[]): LlmEndpoint[] {
  return keys.map((apiKey, i) => ({ name: `groq-${i + 1}`, baseUrl: GROQ_URL, model: GROQ_MODEL, apiKey }));
}

/** Splits a comma-separated key list from the environment. */
export function parseKeys(value: string | undefined): string[] {
  return (value ?? "").split(",").map((key) => key.trim()).filter(Boolean);
}

async function callEndpoint(endpoint: LlmEndpoint, request: ChatRequest, fetchFn: typeof fetch): Promise<unknown> {
  const response = await fetchFn(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${endpoint.apiKey}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: endpoint.model,
      temperature: 0,
      max_completion_tokens: 2048,
      reasoning_effort: "low",
      reasoning_format: "hidden",
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: request.schemaName, strict: true, schema: request.schema },
      },
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty response");
  return JSON.parse(content);
}

/**
 * Tries each endpoint in order and returns the first answer `parse` accepts.
 * Any failure moves to the next one. Throws only when all have failed.
 * Errors name the endpoint, never the key.
 */
export async function chatJson<T>(
  endpoints: LlmEndpoint[],
  request: ChatRequest,
  parse: (value: unknown) => T,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const failures: string[] = [];
  for (const endpoint of endpoints) {
    try {
      return parse(await callEndpoint(endpoint, request, fetchFn));
    } catch (e) {
      failures.push(`${endpoint.name}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  throw new Error(`all LLM endpoints failed (${failures.join("; ") || "none configured"})`);
}
