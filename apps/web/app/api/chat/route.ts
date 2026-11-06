import { allow, loadThreads, loadTurns, runTurn, saveTurn, sessionFrom, UserError } from "@/lib/assistant";
import { MAX_MESSAGE, THREAD_ID, type ChatEvent, type StoredTurn } from "@/lib/chatSign";
import { json } from "@/lib/inbox";

export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Streams one turn as NDJSON, then stores it (encrypted) on Arkiv and reports the entity key. */
export async function POST(req: Request) {
  const sender = await sessionFrom(req);
  if (!sender) return json({ error: "Sign in to chat again." }, 401);
  if (!allow(sender)) return json({ error: "That's a lot of messages at once. Wait a minute and try again." }, 429);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const thread = String(body.thread ?? "");
  const seq = Number(body.seq);
  if (!text || text.length > MAX_MESSAGE) return json({ error: `Write a message of up to ${MAX_MESSAGE} characters.` }, 400);
  if (!THREAD_ID.test(thread) || !Number.isInteger(seq) || seq < 0 || seq > 500) return json({ error: "Bad conversation id." }, 400);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-12).map((h) => ({ user: str(h?.user, 4000), assistant: str(h?.assistant, 4000) }));
  const known = (Array.isArray(body.names) ? body.names : []).filter((n): n is string => typeof n === "string" && n.length < 120).slice(0, 50);

  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const enc = new TextEncoder();
      const emit = (e: ChatEvent) => { try { c.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* client left */ } };
      let turn: StoredTurn | undefined;
      try {
        turn = await runTurn({ sender, text, history, known, signal: req.signal }, emit);
      } catch (e) {
        if (!req.signal.aborted) emit({ t: "error", message: e instanceof UserError ? e.message : "The assistant couldn't answer just now. Try again." });
      }
      emit({ t: "end" });
      if (turn?.assistant.trim()) {
        try {
          emit({ t: "saved", key: await saveTurn(sender, thread, seq, turn) });
        } catch (e) {
          emit({ t: "save-failed", reason: e instanceof UserError ? e.message : "Couldn't save this turn to Arkiv." });
        }
      }
      try { c.close(); } catch { /* already closed */ }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

/** `?thread=<id>` returns that conversation's turns; without it, the list of conversations. */
export async function GET(req: Request) {
  const sender = await sessionFrom(req);
  if (!sender) return json({ error: "Sign in to chat again." }, 401);
  const thread = new URL(req.url).searchParams.get("thread");
  if (thread !== null && !THREAD_ID.test(thread)) return json({ error: "Bad conversation id." }, 400);
  try {
    return json(thread ? { turns: await loadTurns(sender, thread) } : { threads: await loadThreads(sender) });
  } catch {
    // Raw errors can contain the keyed Arkiv RPC URL.
    return json({ error: "Couldn't read your chats from Arkiv right now." }, 502);
  }
}
