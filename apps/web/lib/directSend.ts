// Pay with Direct, server side. A send is a vault bill to direct.<family>.eth, raised by Kin's direct
// biller only when the sender asks, so the vault's own escrow holds the USDT: the provider takes it only
// after Transak pays the friend (markPaid), a failed order refunds it to the vault, and anyone can
// reclaim it after a day. The friend claims through a secret link tied to their email.
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createWalletClient, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash } from "viem/ens";
import { PAYEE_BOOK_PARENT, settlementChain, USDT } from "@ghar/shared";
import { buildPayeeName } from "@ghar/ens";
import { billDigest, receiptForDigest } from "@ghar/arkiv";
import { postBill } from "@ghar/arkiv/write";
import { DEPOSIT_JOURNAL, directPayouts } from "@ghar/agent/direct";
import { chatAgent, keyEnv, queue } from "./assistant";
import { chainClient, ensClient, vault } from "./chain";
import { seal, unseal } from "./chatCrypto";
import { CLAIM_HOURS, maskEmail, type ClaimView, type Currency, type SendRow } from "./directShared";
import { arkiv, providerWallet } from "./inbox";

export const directPayee = () => buildPayeeName(PAYEE_BOOK_PARENT, "direct");
const directBiller = () => { const k = keyEnv("DIRECT_BILLER_PRIVATE_KEY"); return k ? { key: k, address: privateKeyToAccount(k).address } : undefined; };
const secret = () => process.env.CHAT_SECRET ?? "";

export const configured = () =>
  !!directBiller() && !!chatAgent() && !!keyEnv("PROVIDER_PRIVATE_KEY") && !!keyEnv("SEPOLIA_PRIVATE_KEY")
  && !!process.env.TRANSAK_API_KEY && !!process.env.TRANSAK_API_SECRET && secret().length >= 32;

// shortcut: claims (with the friend's email) live in a local file, never on Arkiv or ENS since both are public; a provider's own database in production.
const CLAIMS = `${process.cwd().replace(/\/apps\/web$/, "")}/.direct-claims.jsonl`;
type Claim = { digest: Hex; sender: Address; email: string; currency: Currency; amount: string; tokenHash: string; sealedToken: Hex; at: number };
const claims = (): Claim[] => (existsSync(CLAIMS) ? readFileSync(CLAIMS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Claim) : []);
const claimFor = (digest: Hex) => claims().find((c) => c.digest.toLowerCase() === digest.toLowerCase());
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Constant-time check of the claim link's secret. */
export function claimWithToken(digest: Hex, token: string): Claim | undefined {
  const c = claimFor(digest);
  if (!c || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return undefined;
  const a = Buffer.from(hash(token)), b = Buffer.from(c.tokenHash);
  return a.length === b.length && timingSafeEqual(a, b) ? c : undefined;
}

const linkFor = (c: Claim, origin: string) => `${origin}/claim/${c.digest}?t=${unseal<string>(secret(), c.sender, c.sealedToken)}`;

let runner: ReturnType<typeof directPayouts> | undefined;
/** The provider's payout steps (shared with the settler), driven by the claim page. */
export function payouts() {
  const key = keyEnv("PROVIDER_PRIVATE_KEY")!;
  return (runner ??= directPayouts({
    chain: chainClient as never,
    wallet: createWalletClient({ chain: settlementChain, account: privateKeyToAccount(key), transport: http(process.env.NEXT_PUBLIC_WHITECHAIN_RPC_URL ?? "https://rpc.testnet.whitechain.io") }) as never,
    ens: ensClient as never, arkiv: arkiv(), providerKey: key,
    arkivAccessKey: process.env.ARKIV_ACCESS_KEY ?? "", arkivMaxFeeWei: BigInt(process.env.ARKIV_MAX_FEE_WEI || "10000000000000000"),
    journal: ".arkiv-journal.jsonl", depositJournal: DEPOSIT_JOURNAL,
    sellEth: process.env.TRANSAK_SELL_ETH || "0.02",
  }));
}
/** Payout steps run one at a time, whichever page or tab polls. */
export const steps = queue();
const billWrites = queue();

/** What stops this sender from sending `amount` now, read from the vault. */
export async function readiness(sender: Address) {
  const node = namehash(directPayee());
  const agent = chatAgent()!.address;
  const read = <T,>(functionName: string, args: unknown[]) => chainClient.readContract({ ...vault, functionName, args } as never) as Promise<T>;
  const [biller, payeeAvailable, agentAvailable, balance] = await Promise.all([
    read<Address>("billerOf", [sender, node]), read<bigint>("availableToPayee", [sender, node]),
    read<bigint>("availableToAgent", [sender, agent]), read<bigint>("balanceOf", [sender]),
  ]);
  return { biller, payeeAvailable, agentAvailable, balance, agent, directBiller: directBiller()!.address };
}

/** Raises the send's bill on Arkiv from the direct biller and records the claim. The sender pays it next. */
export async function createSend(sender: Address, amount: bigint, currency: Currency, email: string) {
  const r = await readiness(sender);
  if (r.biller.toLowerCase() !== r.directBiller.toLowerCase()) throw new Error("Add Direct to your vault first.");
  if (amount > r.payeeAvailable) throw new Error(`Your Direct cap allows ${formatUnits(r.payeeAvailable, USDT.decimals)} USDT right now.`);
  if (amount > r.agentAvailable) throw new Error(`The chat agent's grant allows ${formatUnits(r.agentAvailable, USDT.decimals)} USDT right now.`);
  if (amount > r.balance) throw new Error(`Your vault holds ${formatUnits(r.balance, USDT.decimals)} USDT.`);
  const w = directBiller()!;
  const bill = {
    payee: directPayee(), invoiceRef: `DIRECT-${currency}-${randomBytes(4).toString("hex")}`, amount,
    dueDate: Math.floor(Date.now() / 1000) + CLAIM_HOURS * 3600, currency,
  };
  // The bill on Arkiv is public: it carries no email or name, only the amount and currency.
  await billWrites(() => postBill({
    accessKey: process.env.ARKIV_ACCESS_KEY ?? "", privateKey: w.key, journal: ".arkiv-journal.jsonl",
    maxCostWei: BigInt(process.env.ARKIV_MAX_FEE_WEI || "10000000000000000"),
  }, bill));
  const digest = billDigest(bill);
  const token = randomBytes(24).toString("base64url");
  const claim: Claim = { digest, sender, email, currency, amount: amount.toString(), tokenHash: hash(token), sealedToken: seal(secret(), sender, token), at: Date.now() };
  appendFileSync(CLAIMS, JSON.stringify(claim) + "\n");
  return digest;
}

const STATUS = ["unpaid", "pending", "paid", "refunded"] as const;
const statusOf = async (digest: Hex) =>
  STATUS[(await chainClient.readContract({ ...vault, functionName: "payoutOf", args: [digest] }) as readonly [Address, bigint, number, bigint])[2]] ?? "unpaid";

/** The share link for one of this sender's sends. */
export function linkOf(sender: Address, digest: Hex, origin: string) {
  const c = claimFor(digest);
  return c && c.sender.toLowerCase() === sender.toLowerCase() ? linkFor(c, origin) : undefined;
}

export async function sendsOf(sender: Address, origin: string): Promise<SendRow[]> {
  const mine = claims().filter((c) => c.sender.toLowerCase() === sender.toLowerCase()).slice(-20).reverse();
  return Promise.all(mine.map(async (c) => {
    const status = await statusOf(c.digest);
    return {
      digest: c.digest, amountUsdt: formatUnits(BigInt(c.amount), USDT.decimals), currency: c.currency, email: maskEmail(c.email), at: c.at, status,
      ...(status !== "unpaid" ? { link: linkFor(c, origin) } : {}),
    };
  }));
}

// Polling claim pages share one answer per payout for a few seconds.
const recent = new Map<Hex, { at: number; view: Promise<ClaimView> }>();

/** The claim page's view. While a payout is pending it also moves the provider's steps forward. */
export function claimView(c: Claim): Promise<ClaimView> {
  const hit = recent.get(c.digest);
  if (hit && Date.now() - hit.at < 4000) return hit.view;
  const view = steps(async (): Promise<ClaimView> => {
    const base = {
      amountUsdt: formatUnits(BigInt(c.amount), USDT.decimals), currency: c.currency, from: `${c.sender.slice(0, 6)}…${c.sender.slice(-4)}`,
      email: maskEmail(c.email), expired: Date.now() > c.at + CLAIM_HOURS * 3_600_000,
    };
    const p = payouts();
    const r = await p.review(c.digest);
    const status = r.status === "none" ? "unpaid" : r.status;
    if (status === "pending") {
      const step = await p.advance(c.digest);
      return { ...base, status: step.stage === "paid" ? "paid" : step.stage === "refunded" ? "refunded" : "pending", stage: step.stage, orderStatus: step.orderStatus,
        lockTx: r.lockTx, depositTx: step.depositTx, settleTx: step.settleTx, receiptKey: step.receiptKey };
    }
    // Receipts count only from the vault's provider wallet.
    const receipt = r.receiptKey ? await receiptForDigest(arkiv(), c.digest, await providerWallet()) : undefined;
    return {
      ...base, status, lockTx: r.lockTx, receiptKey: r.receiptKey,
      ...(receipt ? { settleTx: receipt.settlementTx, fiat: receipt.fiat, providerRef: receipt.providerRef } : {}),
    };
  });
  recent.set(c.digest, { at: Date.now(), view });
  view.catch(() => recent.delete(c.digest));
  return view;
}

/** Opens the Transak order for the friend, bound to their email, returning to the claim page. */
export async function startClaim(c: Claim, token: string, origin: string) {
  if (Date.now() > c.at + CLAIM_HOURS * 3_600_000) throw new Error("This claim link has expired. Ask the sender to send again.");
  return steps(() => payouts().start(c.digest, { fiatCurrency: c.currency, email: c.email, redirectURL: `${origin}/claim/${c.digest}?t=${token}` }));
}

