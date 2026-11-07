import { isHash, type Address, type Hex } from "viem";
import { billByDigest } from "@ghar/arkiv";
import { transakView } from "@ghar/agent/direct";
import { keyEnv } from "@/lib/assistant";
import { chainClient, explain, vault } from "@/lib/chain";
import { payouts, steps } from "@/lib/directSend";
import { arkiv, json } from "@/lib/inbox";

export const dynamic = "force-dynamic";

const ready = () => !!process.env.TRANSAK_API_KEY && !!process.env.TRANSAK_API_SECRET && !!keyEnv("PROVIDER_PRIVATE_KEY") && !!keyEnv("SEPOLIA_PRIVATE_KEY");
const pending = async (digest: Hex) =>
  ((await chainClient.readContract({ ...vault, functionName: "payoutOf", args: [digest] })) as readonly [Address, bigint, number, bigint])[2] === 1;

/**
 * Transak's record of the order behind a payout digest. While the vault still holds the USDT and an order exists,
 * reading it also runs the provider's next step (deposit, then markPaid), like the claim page does.
 */
export async function GET(req: Request) {
  const digest = new URL(req.url).searchParams.get("digest") ?? "";
  if (!isHash(digest)) return json({ error: "That isn't a digest." }, 400);
  if (!ready()) return json({ error: "Transak isn't configured on this server." }, 503);
  try {
    let view = await transakView(digest as Hex);
    let stage: string | undefined;
    let openable = false;
    let currency: string | undefined;
    const locked = await pending(digest as Hex);
    if (view.order && locked) {
      // Every step reads the chain and the deposit journal first, so a repeat call never pays twice.
      stage = (await steps(() => payouts().advance(digest as Hex))).stage;
      view = await transakView(digest as Hex);
    } else if (locked) {
      // INR pays out through P2P.me, so only other currencies get the Transak button.
      currency = (await billByDigest(arkiv(), digest as Hex))?.currency;
      openable = currency !== "INR";
    }
    return json({ ...view, stage, openable, currency });
  } catch {
    return json({ error: "Couldn't reach Transak right now." }, 502);
  }
}

/** Opens the Transak widget for a pending payout, sized so the payee receives the bill amount. */
// shortcut: anyone with a pending digest can open the widget (staging demo); in production the provider sends it to the KYC'd payee.
export async function POST(req: Request) {
  const { digest } = (await req.json().catch(() => ({}))) as { digest?: string };
  if (!digest || !isHash(digest)) return json({ error: "That isn't a digest." }, 400);
  if (!ready()) return json({ error: "Transak isn't configured on this server." }, 503);
  try {
    const out = await steps(() => payouts().start(digest as Hex, { fiatCurrency: "USD" }));
    if (!out.widgetUrl) return json({ error: "INR payouts go through P2P.me, not Transak." }, 422);
    return json({ widgetUrl: out.widgetUrl });
  } catch (e) {
    return json({ error: explain(e) }, 422);
  }
}
