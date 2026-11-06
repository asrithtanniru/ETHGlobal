import { isHash, type Hex } from "viem";
import { explain } from "@/lib/chain";
import { claimView, claimWithToken, startClaim } from "@/lib/directSend";
import { json } from "@/lib/inbox";

export const dynamic = "force-dynamic";

const claimOf = (digest: unknown, token: unknown) =>
  isHash(String(digest)) && typeof token === "string" ? claimWithToken(digest as Hex, token) : undefined;

/** The friend's view of a send. Reading it also moves a pending payout forward. Needs the link's secret. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = claimOf(u.searchParams.get("digest"), u.searchParams.get("t"));
  if (!c) return json({ error: "This claim link isn't valid." }, 404);
  try {
    return json(await claimView(c));
  } catch (e) {
    return json({ error: explain(e) }, 502);
  }
}

/** Opens the Transak order for this claim and returns where to send the friend. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { digest?: string; t?: string };
  const c = claimOf(body.digest, body.t);
  if (!c) return json({ error: "This claim link isn't valid." }, 404);
  try {
    const { widgetUrl } = await startClaim(c, body.t!, new URL(req.url).origin);
    return json({ widgetUrl });
  } catch (e) {
    return json({ error: explain(e) }, 422);
  }
}
