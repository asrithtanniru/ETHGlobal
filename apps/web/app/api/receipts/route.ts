import { isHash, type Hex } from "viem";
import { receiptForDigest } from "@ghar/arkiv";
import { arkiv, json, providerWallet } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/** Receipt for a payout digest, from the provider wallet only. */
export async function GET(req: Request) {
  const digest = new URL(req.url).searchParams.get("digest") ?? "";
  if (!isHash(digest)) return json({ error: "That isn't a digest." }, 400);
  try {
    return json({ receipt: (await receiptForDigest(arkiv(), digest as Hex, await providerWallet())) ?? null });
  } catch {
    return json({ error: "Couldn't read Arkiv right now." }, 502);
  }
}
