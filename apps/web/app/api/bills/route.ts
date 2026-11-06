import { billsForPayee, checkBill, receiptForDigest } from "@ghar/arkiv";
import { getVerifiedPayee, parsePayeeName } from "@ghar/ens";
import { ensClient } from "@/lib/chain";
import { arkiv, json, providerWallet } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/** Every bill posted under a payee name, each checked the way the agent checks it. */
export async function GET(req: Request) {
  const payee = new URL(req.url).searchParams.get("payee") ?? "";
  try {
    parsePayeeName(payee);
  } catch {
    return json({ error: "That isn't a payee name." }, 400);
  }
  let state;
  try {
    state = await getVerifiedPayee(ensClient as never, payee);
  } catch {
    return json({ error: "No verified records on that name yet." }, 404);
  }
  try {
    const client = arkiv();
    const [bills, provider] = await Promise.all([billsForPayee(client, state.name), providerWallet()]);
    const rows = await Promise.all(bills.map(async (b) => {
      const [check, receipt] = await Promise.all([checkBill(b, state), receiptForDigest(client, b.digest, provider)]);
      return { ...b, check, receiptKey: receipt?.key, receiptStatus: receipt?.status };
    }));
    return json({ payee: state, bills: rows });
  } catch {
    // Raw errors can contain the keyed RPC URL.
    return json({ error: "Couldn't read Arkiv right now." }, 502);
  }
}
