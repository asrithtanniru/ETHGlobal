import { isHash, type Hex } from "viem";
import { payApproved, sessionFrom, UserError } from "@/lib/assistant";
import { chainClient, explain } from "@/lib/chain";
import { payMessage } from "@/lib/chatSign";
import { json } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/** Pays one bill after the sender signed the approval for that exact digest. */
export async function POST(req: Request) {
  const sender = await sessionFrom(req);
  if (!sender) return json({ error: "Sign in to chat again." }, 401);
  const { payee, digest, signature } = (await req.json().catch(() => ({}))) as { payee?: string; digest?: string; signature?: Hex };
  if (typeof payee !== "string" || !isHash(digest ?? "") || typeof signature !== "string") return json({ error: "Bad payment request." }, 400);
  const approved = await chainClient.verifyMessage({ address: sender, message: payMessage(digest as Hex, sender), signature }).catch(() => false);
  if (!approved) return json({ error: "That approval wasn't signed by this vault's wallet." }, 403);
  try {
    return json({ hash: await payApproved(sender, payee.toLowerCase(), digest as Hex) });
  } catch (e) {
    return json({ error: e instanceof UserError ? e.message : explain(e) }, 422);
  }
}
