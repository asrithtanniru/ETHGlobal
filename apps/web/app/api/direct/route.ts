import { isHash, type Hex } from "viem";
import { allow, payApproved, sessionFrom, UserError } from "@/lib/assistant";
import { chainClient, explain } from "@/lib/chain";
import { payMessage } from "@/lib/chatSign";
import { configured, createSend, directPayee, linkOf, readiness } from "@/lib/directSend";
import { parseSend } from "@/lib/directShared";
import { json } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/** Is Direct set up here, and (signed in) what this sender's vault allows right now. */
export async function GET(req: Request) {
  const sender = await sessionFrom(req);
  if (!configured()) return json({ configured: false, payee: directPayee() });
  return json({ configured: true, payee: directPayee(), ...(sender ? { ready: await readiness(sender) } : {}) });
}

/** `create` raises the send's bill; `pay` pays it from the vault after the sender's signed approval. */
export async function POST(req: Request) {
  const sender = await sessionFrom(req);
  if (!sender) return json({ error: "Sign in with your wallet first." }, 401);
  if (!configured()) return json({ error: "Pay with Direct isn't set up on this server." }, 503);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const origin = new URL(req.url).origin;
  try {
    if (body.action === "create") {
      const send = parseSend(body);
      if ("error" in send) return json({ error: send.error }, 400);
      // Each send posts a bill to Arkiv, which costs the direct biller gas.
      if (!allow(`direct:${sender}`, 10, 3_600_000)) return json({ error: "That's 10 sends this hour. Try again later." }, 429);
      const digest = await createSend(sender, send.amount, send.currency, send.email);
      return json({ digest, message: payMessage(digest, sender) });
    }
    if (body.action === "pay") {
      if (!isHash(String(body.digest)) || typeof body.signature !== "string") return json({ error: "Bad request." }, 400);
      const digest = body.digest as Hex;
      if (!linkOf(sender, digest, origin)) return json({ error: "That isn't one of your sends." }, 404);
      const ok = await chainClient.verifyMessage({ address: sender, message: payMessage(digest, sender), signature: body.signature as Hex }).catch(() => false);
      if (!ok) return json({ error: "That approval wasn't signed by this wallet." }, 403);
      const hash = await payApproved(sender, directPayee(), digest);
      return json({ hash, link: linkOf(sender, digest, origin) });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof UserError || e instanceof Error ? explain(e) : "That didn't work." }, 422);
  }
}
