import { isHash, type Hex } from "viem";
import { billByDigest, billsForPayee, checkBill, receiptForDigest, type InboxBill } from "@ghar/arkiv";
import { getVerifiedPayee, parsePayeeName } from "@ghar/ens";
import { chatAgent } from "@/lib/assistant";
import { chainClient, ensClient, vault } from "@/lib/chain";
import { arkiv, providerWallet } from "@/lib/inbox";

export const dynamic = "force-dynamic";

// Public, read-only data for the embeddable widget (public/widget.js), so any merchant site may call it.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" };
const out = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });

// shortcut: per-process 10 s cache so polling widgets don't hammer the RPCs; use a shared cache when scaling out.
const cache = new Map<string, { at: number; body: Promise<unknown> }>();

const STATUS = ["open", "pending", "paid", "refunded"] as const;

async function row(b: InboxBill, payee: Awaited<ReturnType<typeof getVerifiedPayee>>, origin: string) {
  const [, , st] = (await chainClient.readContract({ ...vault, functionName: "payoutOf", args: [b.digest] })) as readonly [unknown, unknown, number, bigint];
  let status: string = STATUS[st] ?? "open";
  if (st === 0) {
    const c = await checkBill(b, payee);
    status = c.ok ? "open" : c.reason === "past-due" ? "past-due" : "invalid";
  }
  const receipt = st >= 2 ? await receiptForDigest(arkiv(), b.digest, await providerWallet()) : undefined;
  return {
    digest: b.digest, invoiceRef: b.invoiceRef, amount: b.amount, currency: b.currency, dueDate: b.dueDate, note: b.note, status,
    receipt: receipt && { url: `${origin}/receipt/${receipt.key}`, status: receipt.status, fiat: receipt.fiat, providerRef: receipt.providerRef, settlementTx: receipt.settlementTx },
    payUrl: `${origin}/app/pay/${b.digest}`,
  };
}

async function load(url: URL) {
  const digest = url.searchParams.get("digest");
  let bills: InboxBill[];
  let payee;
  if (digest) {
    if (!isHash(digest)) throw new Error("bad-request");
    const bill = await billByDigest(arkiv(), digest as Hex);
    if (!bill) throw new Error("not-found");
    payee = await getVerifiedPayee(ensClient as never, bill.payee);
    bills = [bill];
  } else {
    const name = (url.searchParams.get("payee") ?? "").toLowerCase();
    parsePayeeName(name);
    payee = await getVerifiedPayee(ensClient as never, name);
    const invoice = url.searchParams.get("invoice");
    bills = (await billsForPayee(arkiv(), payee.name)).filter((b) => !invoice || b.invoiceRef === invoice).slice(0, 50);
  }
  // Only bills the payee's ENS biller posted count, as for the agent.
  bills = bills.filter((b) => b.creator.toLowerCase() === payee.biller.toLowerCase() && b.payee === payee.name);
  return {
    payee: { name: payee.name, payoutRef: payee.payoutRef },
    chatAgent: chatAgent()?.address ?? null,
    // "invalid" covers bills signed for another vault (such as v1), which this vault can never pay.
    bills: (await Promise.all(bills.map((b) => row(b, payee, url.origin)))).filter((b) => b.status !== "invalid"),
  };
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** `?payee=<name>[&invoice=<ref>]` lists a payee's bills with live status; `?digest=<0x…>` returns one bill. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.search;
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > 10_000) cache.set(key, { at: Date.now(), body: load(url) });
  try {
    return out(await cache.get(key)!.body);
  } catch (e) {
    cache.delete(key);
    const m = (e as Error).message;
    if (m === "bad-request" || /payee name|Invalid/i.test(m)) return out({ error: "That isn't a payee name or bill id." }, 400);
    if (m === "not-found") return out({ error: "No bill with that id on Arkiv." }, 404);
    if (/missing payee records/.test(m)) return out({ error: "That payee has no verified records in ENS." }, 404);
    // Raw errors can contain the keyed Arkiv RPC URL.
    return out({ error: "Couldn't read Arkiv or Whitechain right now." }, 502);
  }
}
