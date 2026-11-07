// Provider-side settler: PayoutRequested on the vault -> Transak staging order -> markPaid or refund
// -> GharReceipt on Arkiv. Needs a vault deployed with settlement, and the vault's provider key.
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ensChain, GHAR_VAULT, gharVaultAbi, settlementChain } from "@ghar/shared";
import { arkivClient } from "@ghar/arkiv";
import { DEPOSIT_JOURNAL, directPayouts, viaP2p } from "./direct.ts";

const env = (k: string) => process.env[k] || (() => { throw new Error(`${k} is not set`); })();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const key = env("PROVIDER_PRIVATE_KEY") as Hex;
const account = privateKeyToAccount(key);
const transport = http(process.env.WHITECHAIN_RPC_URL ?? "https://rpc.testnet.whitechain.io");
const chain = createPublicClient({ chain: settlementChain, transport });
const wallet = createWalletClient({ chain: settlementChain, transport, account });
const vault = { address: GHAR_VAULT, abi: gharVaultAbi } as const;
const ens = createPublicClient({ chain: ensChain, transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
const arkiv = arkivClient();
const explorer = settlementChain.blockExplorers?.default.url;

const provider = await chain.readContract({ ...vault, functionName: "provider" });
if (provider.toLowerCase() !== account.address.toLowerCase()) throw new Error(`PROVIDER_PRIVATE_KEY is ${account.address}, the vault's provider is ${provider}`);

const direct = directPayouts({
  chain: chain as never, wallet: wallet as never, ens: ens as never, arkiv, providerKey: key,
  arkivAccessKey: process.env.ARKIV_ACCESS_KEY ?? "", arkivMaxFeeWei: BigInt(process.env.ARKIV_MAX_FEE_WEI ?? "0"),
  journal: ".arkiv-journal.jsonl", depositJournal: DEPOSIT_JOURNAL,
  sellEth: process.env.TRANSAK_SELL_ETH || "0.02", email: process.env.TRANSAK_EMAIL,
});
const FINAL = new Set(["paid", "refunded", "receipt-pending", "review-failed", "deposit-uncertain", "amount-mismatch"]);

const report = (digest: Hex, p: { stage: string; settleTx?: Hex; receiptKey?: Hex; reason?: string }) => {
  log(`${digest.slice(0, 10)}: ${p.stage}${p.reason ? ` (${p.reason})` : ""}`);
  if (p.settleTx) log(`[Whitechain] ${explorer}/tx/${p.settleTx}`);
  if (p.receiptKey) log(`[Arkiv] receipt ${p.receiptKey}`);
};

async function settle(digest: Hex) {
  const r = await direct.review(digest);
  if (r.status !== "pending") return log(`skip ${digest.slice(0, 10)}: not pending`);
  if (r.receiptKey) return log(`skip ${digest.slice(0, 10)}: receipt exists`);
  if (!r.check.ok) {
    log(`refusing ${digest.slice(0, 10)}: ${r.check.reason}`);
    return report(digest, await direct.finish(digest, { ok: false, reason: r.check.reason }));
  }
  log(`[ENS] ${r.payee} payoutRef=${r.check.payoutRef}`);
  // The UPI ID comes from the friend, so an INR payout starts and moves from the claim page.
  if (viaP2p(r.bill)) return log(`skip ${digest.slice(0, 10)}: INR, paid out through P2P.me from the claim page`);
  let opened;
  try {
    opened = await direct.start(digest);
  } catch (e) {
    log("[Transak] error:", (e as Error).message.split("\n")[0]);
    return report(digest, await direct.finish(digest, { ok: false, reason: "provider error" }));
  }
  const sized = "eth" in opened ? `, selling ${opened.eth} Sepolia ETH so the payee receives ${opened.receivesUsd} USD` : "";
  log(`[Transak] order ${opened.orderId} for ${r.amountUsdt} USDT to ${opened.payoutRef}${sized}. Open within 5 minutes and confirm:\n  ${opened.widgetUrl}`);
  let last = "", deposit = "";
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const p = await direct.advance(digest).catch((e) => { log("advance failed:", (e as Error).message.split("\n")[0]); return undefined; });
    if (!p) continue;
    if (p.orderStatus && p.orderStatus !== last) { last = p.orderStatus; log(`[Transak] ${p.orderId}: ${p.orderStatus}`); }
    if (p.depositTx && p.depositTx !== deposit) { deposit = p.depositTx; log(`[Sepolia] deposit https://sepolia.etherscan.io/tx/${p.depositTx}`); }
    if (FINAL.has(p.stage)) return report(digest, p);
  }
  report(digest, await direct.finish(digest, { ok: false, reason: "Transak order timed out" }));
}

log(`settler ${account.address} watching ${GHAR_VAULT}`);
let from = process.env.SETTLER_FROM_BLOCK ? BigInt(process.env.SETTLER_FROM_BLOCK) : await chain.getBlockNumber();
for (;;) {
  try {
    const head = await chain.getBlockNumber();
    const to = from + 9_999n < head ? from + 9_999n : head; // the RPC caps log ranges at 10,000 blocks
    if (to >= from) {
      const events = await chain.getContractEvents({ ...vault, eventName: "PayoutRequested", fromBlock: from, toBlock: to });
      for (const e of events) await settle(e.args.digest!);
      from = to + 1n;
    }
  } catch (e) {
    log("poll failed:", (e as Error).message.split("\n")[0]);
  }
  await sleep(5000);
}
