import { test } from "node:test";
import assert from "node:assert/strict";
import { chatStream, groqEndpoints, readChatStream } from "../src/llm.ts";

const sse = (chunks: string[]) => new Response(new ReadableStream({
  start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); },
}));
const ev = (delta: object) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

test("joins text deltas and tool-call fragments, even when a line is split across chunks", async () => {
  const line = ev({ tool_calls: [{ index: 0, function: { arguments: '"rent"}' } }] });
  const seen: string[] = [];
  const out = await readChatStream(sse([
    ev({ content: "Hel" }), ev({ content: "lo" }),
    ev({ tool_calls: [{ index: 0, id: "c1", function: { name: "check_bills", arguments: '{"payee":' } }] }),
    line.slice(0, 20), line.slice(20), "data: [DONE]\n\n",
  ]).body!, (d) => seen.push(d));
  assert.equal(out.content, "Hello");
  assert.deepEqual(seen, ["Hel", "lo"]);
  assert.deepEqual(out.toolCalls, [{ id: "c1", type: "function", function: { name: "check_bills", arguments: '{"payee":"rent"}' } }]);
});

test("falls back to the next key only before anything streamed", async () => {
  let n = 0;
  const fetchFn = (async () => (++n === 1 ? new Response("no", { status: 429 }) : sse([ev({ content: "ok" })]))) as unknown as typeof fetch;
  const out = await chatStream(groqEndpoints(["a", "b"]), [], [], () => {}, undefined, fetchFn);
  assert.equal(out.content, "ok");
  assert.equal(n, 2);
});
