// Provider-side settler: PayoutRequested on the vault -> Transak staging order -> markPaid or refund
// -> GharReceipt on Arkiv. Needs a vault deployed with settlement, and the vault's provider key.
import { createPublicClient, createWalletClient, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GHAR_VAULT, gharVaultAbi, settlementChain, USDT } from "@ghar/shared";
import { arkivClient, billByDigest, receiptForDigest } from "@ghar/arkiv";
import { postReceipt } from "@ghar/arkiv/write";
// @ts-expect-error plain JS helper from the payout spike
import * as transak from "../../../ghar-payout-spike/adapter/transak.mjs";

const env = (k: string) => process.env[k] || (() => { throw new Error(`${k} is not set`); })();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const key = env("PROVIDER_PRIVATE_KEY") as Hex;
const account = privateKeyToAccount(key);
const transport = http(process.env.WHITECHAIN_RPC_URL ?? "https://rpc.testnet.whitechain.io");
const chain = createPublicClient({ chain: settlementChain, transport });
const wallet = createWalletClient({ chain: settlementChain, transport, account });
const vault = { address: GHAR_VAULT, abi: gharVaultAbi } as const;
const arkiv = arkivClient();
const explorer = settlementChain.blockExplorers?.default.url;

const provider = await chain.readContract({ ...vault, functionName: "provider" });
if (provider.toLowerCase() !== account.address.toLowerCase()) throw new Error(`PROVIDER_PRIVATE_KEY is ${account.address}, the vault's provider is ${provider}`);

/** Runs the Transak order and returns how it ended. The payee confirms in the widget, as in staging. */
async function payout(digest: Hex, usdt: string): Promise<{ ok: true; ref: string; fiat: string } | { ok: false; reason: string }> {
  const partnerOrderId = `ghar-${digest.slice(2, 10)}-${Date.now()}`;
  const ethAmount = process.env.TRANSAK_SELL_ETH || "0.02"; // staging sells Sepolia ETH, not USDT
  try {
    const url = await transak.createSellWidget({ partnerOrderId, cryptoAmount: Number(ethAmount), email: process.env.TRANSAK_EMAIL });
    log(`[Transak] order ${partnerOrderId} for ${usdt} USDT. Open within 5 minutes and confirm:\n  ${url}`);
    let sent = false, last = "";
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      await sleep(5000);
      const order = await transak.getOrder(partnerOrderId).catch(() => null);
      if (!order) continue;
      if (order.status !== last) { last = order.status; log(`[Transak] ${order.id}: ${order.status}`); }
      if (!sent && order.status === "AWAITING_PAYMENT_FROM_USER" && order.cryptoPaymentData?.paymentAddress) {
        const h = await transak.sendDeposit(order.cryptoPaymentData.paymentAddress, ethAmount);
        sent = true;
        log(`[Sepolia] deposit https://sepolia.etherscan.io/tx/${h}`);
      }
      if (transak.DONE.includes(order.status)) return { ok: true, ref: order.id, fiat: `${order.fiatAmount} ${order.fiatCurrency}` };
      if (transak.DEAD.includes(order.status)) return { ok: false, reason: `Transak order ${order.status}` };
    }
    return { ok: false, reason: "Transak order timed out" };
  } catch (e) {
    log("[Transak] error:", (e as Error).message.split("\n")[0]);
    return { ok: false, reason: "provider error" };
  }
}

async function settle(digest: Hex, amount: bigint) {
  const usdt = formatUnits(amount, USDT.decimals);
  const [, , status] = await chain.readContract({ ...vault, functionName: "payoutOf", args: [digest] }) as readonly [Address, bigint, number, bigint];
  if (status !== 1) return log(`skip ${digest.slice(0, 10)}: not pending`);
  if (await receiptForDigest(arkiv, digest, account.address)) return log(`skip ${digest.slice(0, 10)}: receipt exists`);

  const bill = await billByDigest(arkiv, digest);
  if (!bill) log(`no Arkiv bill found for ${digest.slice(0, 10)}; the receipt will not link to one`);

  const out = await payout(digest, usdt);
  const hash = await wallet.writeContract(out.ok
    ? { ...vault, functionName: "markPaid", args: [digest, out.ref] }
    : { ...vault, functionName: "refund", args: [digest, out.reason] });
  const mined = await chain.waitForTransactionReceipt({ hash });
  if (mined.status !== "success") throw new Error(`settlement reverted: ${hash}`);
  log(`[Whitechain] ${out.ok ? "markPaid" : "refund"} ${explorer}/tx/${hash}`);

  const r = await postReceipt({
    accessKey: process.env.ARKIV_ACCESS_KEY ?? "", privateKey: key,
    maxCostWei: BigInt(process.env.ARKIV_MAX_FEE_WEI ?? "0"), journal: ".arkiv-journal.jsonl",
  }, {
    digest, billKey: bill?.key ?? (`0x${"0".repeat(64)}` as Hex), payee: bill?.payee ?? "unknown",
    status: out.ok ? "paid" : "refunded", settlementTx: hash,
    providerRef: out.ok ? out.ref : out.reason, ...(out.ok ? { fiat: out.fiat } : {}),
  });
  log(`[Arkiv] receipt ${r.entityKey}\n  https://rabdi.explorer.arkiv.network/tx/${r.txHash}`);
}

log(`settler ${account.address} watching ${GHAR_VAULT}`);
let from = process.env.SETTLER_FROM_BLOCK ? BigInt(process.env.SETTLER_FROM_BLOCK) : await chain.getBlockNumber();
for (;;) {
  try {
    const head = await chain.getBlockNumber();
    const to = from + 9_999n < head ? from + 9_999n : head; // the RPC caps log ranges at 10,000 blocks
    if (to >= from) {
      const events = await chain.getContractEvents({ ...vault, eventName: "PayoutRequested", fromBlock: from, toBlock: to });
      for (const e of events) await settle(e.args.digest!, e.args.amount!);
      from = to + 1n;
    }
  } catch (e) {
    log("poll failed:", (e as Error).message.split("\n")[0]);
  }
  await sleep(5000);
}
