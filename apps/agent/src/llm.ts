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

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ToolSpec { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }

/** Reads an OpenAI-style SSE stream: text deltas go to `onText`, tool-call fragments are joined by index. */
export async function readChatStream(body: ReadableStream<Uint8Array>, onText: (d: string) => void) {
  const calls: ToolCall[] = [];
  let content = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] }).choices?.[0]?.delta;
      if (delta?.content) { content += delta.content; onText(delta.content); }
      for (const t of delta?.tool_calls ?? []) {
        const c = (calls[t.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (t.id) c.id = t.id;
        c.function.name += t.function?.name ?? "";
        c.function.arguments += t.function?.arguments ?? "";
      }
    }
  }
  return { content, toolCalls: calls.filter(Boolean) };
}

/**
 * One streamed chat round with tools. Falls through to the next endpoint only while nothing has
 * streamed yet, so the user never sees two half-answers.
 */
export async function chatStream(
  endpoints: LlmEndpoint[],
  messages: ChatMessage[],
  tools: ToolSpec[],
  onText: (d: string) => void,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
) {
  const failures: string[] = [];
  for (const endpoint of endpoints) {
    let streamed = false;
    try {
      const response = await fetchFn(`${endpoint.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${endpoint.apiKey}`, "content-type": "application/json" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
        body: JSON.stringify({
          model: endpoint.model, temperature: 0.2, max_completion_tokens: 2048, reasoning_effort: "low", reasoning_format: "hidden",
          stream: true, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}),
        }),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      return await readChatStream(response.body, (d) => { streamed = true; onText(d); });
    } catch (e) {
      if (streamed || signal?.aborted) throw e;
      failures.push(`${endpoint.name}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  throw new Error(`all LLM endpoints failed (${failures.join("; ") || "none configured"})`);
}
