// One payout's provider-side steps, shared by the settler (terminal) and the Pay with Direct page (browser).
// Every step reads chain state first, so calling it again never pays, deposits or settles twice.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { formatUnits, isAddress, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { GHAR_VAULT, GHAR_VAULT_DEPLOY_BLOCK, gharVaultAbi, USDT, type VerifiedPayee } from "@ghar/shared";
import { getVerifiedPayee } from "@ghar/ens";
import { billByDigest, receiptForDigest, type ArkivReader, type InboxBill } from "@ghar/arkiv";
import { postReceipt } from "@ghar/arkiv/write";
// @ts-expect-error plain JS helper from the payout spike
import * as transak from "../../../ghar-payout-spike/adapter/transak.mjs";
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
  | "amount-mismatch" | "processing" | "paid" | "refunded" | "receipt-pending";

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

export type DepositEntry = { orderId: string; phase: "intent" | "sent"; hash?: Hex; to?: Address };

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
  async function start(digest: Hex, opts: { fiatCurrency?: string; redirectURL?: string; email?: string } = {}) {
    const r = await review(digest);
    if (r.status !== "pending") throw new Error(`This payout is ${r.status}, not pending.`);
    if (!r.check.ok) throw new Error(`Review failed: ${r.check.reason}. Refund it instead.`);
    const orderId = orderIdFor(digest);
    const widgetUrl = (await transak.createSellWidget({
      partnerOrderId: orderId, cryptoAmount: Number(cfg.sellEth), email: opts.email ?? cfg.email, fiatCurrency: opts.fiatCurrency, redirectURL: opts.redirectURL,
    })) as string;
    return { orderId, widgetUrl, payoutRef: r.check.payoutRef, amountUsdt: r.amountUsdt };
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
