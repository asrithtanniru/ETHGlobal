// One payout's provider-side steps, shared by the settler (terminal) and the Pay with Direct page (browser).
// Every step reads chain state first, so calling it again never pays, deposits or settles twice.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { formatUnits, isAddress, parseUnits, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { GHAR_VAULT, GHAR_VAULT_DEPLOY_BLOCK, gharVaultAbi, USDT, type VerifiedPayee } from "@ghar/shared";
import { getVerifiedPayee } from "@ghar/ens";
import { billByDigest, receiptForDigest, type ArkivReader, type InboxBill } from "@ghar/arkiv";
import { postReceipt } from "@ghar/arkiv/write";
// @ts-expect-error plain JS helper from the payout spike
import * as transak from "../../../ghar-payout-spike/adapter/transak.mjs";
import * as p2pme from "./p2pme.ts";
import type { Order as P2pOrder } from "@p2pdotme/sdk/orders";
import { billMatchesPayee, checkPayout, isMissingPayee, type PayoutCheck } from "./payout-check.ts";

export interface DirectConfig {
  chain: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  ens: PublicClient;
  arkiv: ArkivReader;
  providerKey: Hex;
  arkivAccessKey: string;
  arkivMaxFeeWei: bigint;
  /** The Arkiv write journal (guarded writes). */
  journal: string;
  /** Deposit journal, shared by every process that runs payouts, so a deposit is never sent twice. */
  depositJournal: string;
  /** Staging sells this much Sepolia ETH per order (provider float), not USDT. */
  sellEth: string;
  email?: string;
}

/** At the repo root, from apps/agent or apps/web alike, so the settler and the web page share one journal. */
export const DEPOSIT_JOURNAL = `${process.cwd().replace(/\/apps\/(agent|web)$/, "")}/.direct-deposits.jsonl`;

export const STATUS = ["none", "pending", "paid", "refunded"] as const;
export type Status = (typeof STATUS)[number];
/** One Transak order per payout: a refunded bill stays used in the vault, so there is never a second attempt. */
export const orderIdFor = (digest: Hex) => `ghar-${digest.slice(2, 18)}`;

export type Stage =
  | "review-failed" | "awaiting-widget" | "awaiting-deposit" | "deposit-sent" | "deposit-uncertain"
  | "amount-mismatch" | "processing" | "paid" | "refunded" | "receipt-pending"
  // INR through P2P.me
  | "awaiting-upi" | "order-uncertain" | "awaiting-merchant" | "upi-sent" | "upi-uncertain" | "merchant-paying" | "disputed";

export interface Review {
  digest: Hex;
  status: Status;
  sender: Address;
  amountUsdt: string;
  payee?: string;
  check: PayoutCheck;
  bill?: InboxBill;
  /** The vault transaction that locked the USDT for the provider. */
  lockTx?: Hex;
  receiptKey?: Hex;
}

export interface Progress {
  stage: Stage;
  orderId: string;
  orderStatus?: string;
  depositTx?: Hex;
  settleTx?: Hex;
  receiptKey?: Hex;
  reason?: string;
}

export type DepositEntry = {
  orderId: string;
  phase: "intent" | "sent" | "place-intent" | "placed" | "upi-intent" | "upi-sent";
  hash?: Hex;
  to?: Address;
  /** P2P.me's own order id, and the friend's UPI ID sealed to the provider's relay key. */
  p2pOrderId?: string;
  upi?: string;
};
/** INR sends pay out through P2P.me; every other currency through Transak. */
export const viaP2p = (bill?: { currency: string }) => bill?.currency === "INR";

export function directPayouts(cfg: DirectConfig) {
  const vault = { address: GHAR_VAULT, abi: gharVaultAbi } as const;
  const provider = cfg.wallet.account.address;
  const receiptsTried = new Set<Hex>();

  const deposits = (orderId: string): DepositEntry[] =>
    existsSync(cfg.depositJournal)
      ? readFileSync(cfg.depositJournal, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as DepositEntry).filter((e) => e.orderId === orderId)
      : [];
  const note = (e: DepositEntry) => appendFileSync(cfg.depositJournal, JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n");

  /** The payee node the vault locked funds for, and the tx that locked them, from the chain event, never from an Arkiv entity. */
  async function payoutEvent(digest: Hex): Promise<{ payee: Hex; tx: Hex } | undefined> {
    const head = await cfg.chain.getBlockNumber();
    for (let from = GHAR_VAULT_DEPLOY_BLOCK; from <= head; from += 10_000n) {
      const to = from + 9_999n < head ? from + 9_999n : head;
      const logs = await cfg.chain.getContractEvents({ ...vault, eventName: "PayoutRequested", args: { digest }, fromBlock: from, toBlock: to } as never);
      const hit = (logs as unknown as { args: { payee: Hex }; transactionHash: Hex }[])[0];
      if (hit) return { payee: hit.args.payee, tx: hit.transactionHash };
    }
    return undefined;
  }

  /** Missing records refund the payout, which can't be undone. Any other ENS failure throws, so it is retried. */
  async function readPayee(name: string): Promise<VerifiedPayee | undefined> {
    try {
      return await getVerifiedPayee(cfg.ens as never, name, { strict: true });
    } catch (e) {
      if (isMissingPayee(e)) return undefined;
      throw e;
    }
  }

  /** The provider's own check, from the vault, Arkiv and ENS. */
  async function review(digest: Hex): Promise<Review> {
    const [sender, , st, amount] = (await cfg.chain.readContract({ ...vault, functionName: "payoutOf", args: [digest] })) as readonly [Address, bigint, number, bigint];
    const status = STATUS[st] ?? "none";
    const base = { digest, status, sender, amountUsdt: formatUnits(amount, USDT.decimals) };
    if (status === "none") return { ...base, check: { ok: false, reason: "no-payout" } };
    const receipt = await receiptForDigest(cfg.arkiv, digest, provider);
    const event = await payoutEvent(digest);
    if (!event) return { ...base, receiptKey: receipt?.key, check: { ok: false, reason: "no-payout-event" } };
    const node = event.payee;
    // Only the wallet the sender accepted counts, so a stranger's post can't claim this digest.
    const vaultBiller = (await cfg.chain.readContract({ ...vault, functionName: "billerOf", args: [sender, node] })) as Address;
    const bill = await billByDigest(cfg.arkiv, digest, vaultBiller);
    const payee = bill && billMatchesPayee(bill.payee, node) ? await readPayee(bill.payee) : undefined;
    return { ...base, payee: bill?.payee, bill, lockTx: event.tx, receiptKey: receipt?.key, check: checkPayout(node, bill, payee, vaultBiller) };
  }

  /** Opens the payout order and returns the widget link the recipient confirms in. */
  async function start(digest: Hex, opts: { fiatCurrency?: string; redirectURL?: string; email?: string; upi?: string } = {}) {
    const r = await review(digest);
    if (r.status !== "pending") throw new Error(`This payout is ${r.status}, not pending.`);
    if (!r.check.ok) throw new Error(`Review failed: ${r.check.reason}. Refund it instead.`);
    const orderId = orderIdFor(digest);
    if (viaP2p(r.bill)) return { orderId, widgetUrl: undefined, payoutRef: r.check.payoutRef, amountUsdt: r.amountUsdt, ...(await startP2p(orderId, r, opts.upi)) };
    const widgetUrl = (await transak.createSellWidget({
      partnerOrderId: orderId, cryptoAmount: Number(cfg.sellEth), email: opts.email ?? cfg.email, fiatCurrency: opts.fiatCurrency, redirectURL: opts.redirectURL,
    })) as string;
    return { orderId, widgetUrl, payoutRef: r.check.payoutRef, amountUsdt: r.amountUsdt };
  }

  /** Places the one P2P.me SELL order for this payout; the friend's UPI ID waits sealed until a merchant accepts. */
  async function startP2p(orderId: string, r: Review, upi = "") {
    const log = deposits(orderId);
    const placed = log.find((e) => e.phase === "placed");
    if (placed) return { p2pOrderId: placed.p2pOrderId };
    if (log.length) throw new Error("A P2P.me order may already be open for this payout. The provider has to check it first.");
    upi = upi.trim();
    if (!p2pme.validUpi(upi)) throw new Error("Enter a UPI ID like name@okhdfcbank.");
    const sealed = await p2pme.sealUpi(upi);
    // The intent line goes in only after the preflight passes, so a rejected order can be tried again.
    const out = await p2pme.placeSell(parseUnits(r.amountUsdt, USDT.decimals), () => note({ orderId, phase: "place-intent" }));
    note({ orderId, phase: "placed", p2pOrderId: out.orderId.toString(), hash: out.hash, upi: sealed });
    return { p2pOrderId: out.orderId.toString() };
  }

  /** One P2P.me step: wait for a merchant, hand over the UPI ID once, settle when the order ends. */
  async function advanceP2p(digest: Hex, orderId: string, payoutRef: string): Promise<Progress> {
    const log = deposits(orderId);
    const placed = log.find((e) => e.phase === "placed");
    if (!placed) return { stage: log.length ? "order-uncertain" : "awaiting-upi", orderId };
    const order = await p2pme.getOrder(BigInt(placed.p2pOrderId!));
    const step = nextP2pStep(order, log);
    if (step.kind === "paid") return finish(digest, { ok: true, ref: `P2P.me-${order.orderId}`, fiat: `${formatUnits(order.actualFiatAmount, 6)} INR`, payoutRef });
    if (step.kind === "refund") return finish(digest, { ok: false, reason: step.reason });
    const base = { orderId, orderStatus: order.status, depositTx: log.find((e) => e.phase === "upi-sent")?.hash ?? placed.hash };
    if (step.kind !== "deliver") return { stage: step.kind, ...base };
    note({ orderId, phase: "upi-intent" });
    const hash = await p2pme.deliverUpi(order, placed.upi!);
    note({ orderId, phase: "upi-sent", hash });
    return { stage: "upi-sent", ...base, depositTx: hash };
  }

  /** markPaid or refund if still pending, then the Arkiv receipt if there is none. */
  async function finish(digest: Hex, out: { ok: true; ref: string; fiat: string; payoutRef: string } | { ok: false; reason: string }): Promise<Progress> {
    const orderId = orderIdFor(digest);
    const r = await review(digest);
    let settleTx: Hex | undefined;
    if (r.status === "pending") {
      const { request } = await cfg.chain.simulateContract({
        ...vault, account: cfg.wallet.account,
        ...(out.ok ? { functionName: "markPaid", args: [digest, out.ref] } : { functionName: "refund", args: [digest, out.reason.slice(0, 120)] }),
      } as never);
      settleTx = await cfg.wallet.writeContract(request as never);
      const mined = await cfg.chain.waitForTransactionReceipt({ hash: settleTx });
      if (mined.status !== "success") throw new Error(`Settlement reverted: ${settleTx}`);
    }
    const status = r.status === "pending" ? (out.ok ? "paid" : "refunded") : r.status;
    if (r.receiptKey) return { stage: status as Stage, orderId, settleTx, receiptKey: r.receiptKey };
    if (receiptsTried.has(digest) || !settleTx) return { stage: "receipt-pending", orderId, settleTx, reason: "Settled; the Arkiv receipt still needs posting (see the Arkiv journal)." };
    // Arkiv writes are never resent automatically: one attempt per digest per process.
    receiptsTried.add(digest);
    const rec = await postReceipt({ accessKey: cfg.arkivAccessKey, privateKey: cfg.providerKey, maxCostWei: cfg.arkivMaxFeeWei, journal: cfg.journal }, {
      digest, billKey: r.bill?.key ?? (`0x${"0".repeat(64)}` as Hex), payee: r.bill?.payee ?? "unknown",
      status: out.ok ? "paid" : "refunded", settlementTx: settleTx, providerRef: out.ok ? out.ref : out.reason,
      ...(out.ok ? { fiat: out.fiat, payoutRef: out.payoutRef } : {}),
    });
    return { stage: status as Stage, orderId, settleTx, receiptKey: rec.entityKey as Hex };
  }

  /** One step forward: read the order, send the deposit once when it is asked for, settle when it ends. */
  async function advance(digest: Hex): Promise<Progress> {
    const orderId = orderIdFor(digest);
    const r = await review(digest);
    if (r.status === "paid" || r.status === "refunded") return { stage: r.receiptKey ? r.status : "receipt-pending", orderId, receiptKey: r.receiptKey };
    if (r.status !== "pending") return { stage: "review-failed", orderId, reason: r.check.ok ? r.status : r.check.reason };
    if (!r.check.ok) return { stage: "review-failed", orderId, reason: r.check.reason };
    if (viaP2p(r.bill)) return advanceP2p(digest, orderId, r.check.payoutRef);
    // getOrder is null until the recipient finishes the widget; a Transak failure throws, so it shows instead of "waiting".
    const order = (await transak.getOrder(orderId)) as null | (Order & { fiatAmount?: number; fiatCurrency?: string });
    if (!order) return { stage: "awaiting-widget", orderId };
    const step = nextStep(order, deposits(orderId), cfg.sellEth);
    if (step.kind === "paid") return finish(digest, { ok: true, ref: order.id, fiat: `${order.fiatAmount} ${order.fiatCurrency}`, payoutRef: r.check.payoutRef });
    if (step.kind === "refund") return finish(digest, { ok: false, reason: step.reason });
    if (step.kind !== "send") return { stage: step.kind, orderId, orderStatus: order.status, depositTx: step.depositTx, reason: step.reason };
    const to = step.to;
    note({ orderId, phase: "intent", to });
    const hash = (await transak.sendDeposit(to, cfg.sellEth)) as Hex;
    note({ orderId, phase: "sent", hash, to });
    return { stage: "deposit-sent", orderId, orderStatus: order.status, depositTx: hash };
  }

  return { review, start, advance, finish };
}

type Order = { id: string; status: string; cryptoAmount?: number; cryptoPaymentData?: { paymentAddress?: string } };
type Step =
  | { kind: "paid" } | { kind: "refund"; reason: string } | { kind: "send"; to: Address }
  | { kind: "deposit-sent" | "deposit-uncertain" | "processing" | "amount-mismatch"; depositTx?: Hex; reason?: string };

/** What to do with an order, given the deposit journal. Pure, so the money rule is tested on its own. */
export function nextStep(order: Order, log: DepositEntry[], sellEth: string): Step {
  if (transak.DONE.includes(order.status)) return { kind: "paid" };
  if (transak.DEAD.includes(order.status)) return { kind: "refund", reason: `Transak order ${order.status}` };
  const sent = log.find((e) => e.phase === "sent");
  if (sent) return { kind: "deposit-sent", depositTx: sent.hash };
  if (order.status !== "AWAITING_PAYMENT_FROM_USER") return { kind: "processing" };
  // An intent without a "sent" line means a previous attempt may have sent it: never send blind.
  if (log.some((e) => e.phase === "intent")) return { kind: "deposit-uncertain", reason: "A deposit may already be on its way. Check the Sepolia wallet before doing anything." };
  const to = order.cryptoPaymentData?.paymentAddress;
  if (!to || !isAddress(to)) return { kind: "processing", reason: "Waiting for Transak's deposit address." };
  if (order.cryptoAmount !== undefined && Number(order.cryptoAmount) !== Number(sellEth))
    return { kind: "amount-mismatch", reason: `Transak asks for ${order.cryptoAmount} ETH, but this provider sells ${sellEth}.` };
  return { kind: "send", to };
}

type P2pStep = { kind: "paid" } | { kind: "refund"; reason: string } | { kind: "deliver" }
  | { kind: "awaiting-merchant" | "upi-sent" | "upi-uncertain" | "merchant-paying" | "disputed" };

/** What to do with a P2P.me order, given the journal. Pure, so the money rule is tested on its own. */
export function nextP2pStep(order: Pick<P2pOrder, "status" | "disputeStatus">, log: DepositEntry[]): P2pStep {
  if (order.status === "completed") return { kind: "paid" };
  if (order.status === "cancelled") return { kind: "refund", reason: "P2P.me order cancelled" };
  if (order.disputeStatus === "open") return { kind: "disputed" };
  if (order.status === "placed") return { kind: "awaiting-merchant" };
  // "paid" means the UPI ID is with the merchant, who now sends the INR.
  if (order.status === "paid") return { kind: "merchant-paying" };
  if (log.some((e) => e.phase === "upi-sent")) return { kind: "upi-sent" };
  // An intent without "upi-sent" means the hand-over may be in flight: never send it blind.
  if (log.some((e) => e.phase === "upi-intent")) return { kind: "upi-uncertain" };
  return { kind: "deliver" };
}
