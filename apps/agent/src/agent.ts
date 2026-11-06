// Ghar agent: reads open bills from Arkiv for each payee, checks them against ENS and the vault,
// then pays with pay(). Deterministic rules decide what is payable; the vault enforces the same
// limits on-chain. The AI review runs after them and can only hold a bill.
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash } from "viem/ens";
import { ensChain, GHAR_VAULT, gharVaultAbi, settlementChain, USDT } from "@ghar/shared";
import { buildPayeeName, getVerifiedPayee, payeeFamily } from "@ghar/ens";
import { arkivClient, checkBill, openBills, toVaultBill, type InboxBill } from "@ghar/arkiv";
import { decide } from "./decide.ts";
import { loadHolds, parseDigests, recordHold } from "./holds.ts";
import { groqEndpoints, parseKeys } from "./llm.ts";
import { llmReviewer, noReview, REVIEW_FAILED, reviewBill, vaultPastAmounts } from "./reviewer.ts";

const env = (k: string) => process.env[k] || (() => { throw new Error(`${k} is not set`); })();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

const sender = env("SENDER_ADDRESS") as Address;
const tags = env("PAYEE_TAGS").split(",").map((t) => t.trim()).filter(Boolean);
const account = privateKeyToAccount(env("AGENT_PRIVATE_KEY") as Hex);
const transport = http(process.env.WHITECHAIN_RPC_URL ?? "https://rpc.testnet.whitechain.io");
const chain = createPublicClient({ chain: settlementChain, transport });
const wallet = createWalletClient({ chain: settlementChain, transport, account });
const ens = createPublicClient({ chain: ensChain, transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
const arkiv = arkivClient();
const vault = { address: GHAR_VAULT, abi: gharVaultAbi } as const;
// Bills the sender checked by hand after a hold. Every other rule still applies to them.
const approved = parseDigests(process.env.APPROVED_DIGESTS);
const HOLDS_FILE = ".agent-holds";
const done = loadHolds(HOLDS_FILE, approved); // digests settled or refused for good, plus AI holds from any run
const keys = parseKeys(process.env.GROQ_API_KEYS);
const reviewer = keys.length ? llmReviewer({ endpoints: groqEndpoints(keys), pastAmounts: vaultPastAmounts(chain, sender) }) : noReview;

const read = (functionName: never, args: never) => chain.readContract({ ...vault, functionName, args }) as Promise<unknown>;

async function payBill(bill: InboxBill) {
  const args = [sender, toVaultBill(bill), bill.signature] as const;
  try {
    const { request } = await chain.simulateContract({ ...vault, account, functionName: "pay", args });
    const hash = await wallet.writeContract(request);
    const r = await chain.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`pay reverted: ${hash}`);
    done.add(bill.digest);
    log(`paid ${bill.invoiceRef}: ${formatUnits(bill.amount, USDT.decimals)} USDT to ${bill.payee}`);
    log(`  tx ${settlementChain.blockExplorers?.default.url}/tx/${hash}`);
  } catch (e) {
    const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
    const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
    if (name === "AlreadyPaid") { done.add(bill.digest); return log(`skip ${bill.invoiceRef}: already paid`); }
    log(`not paid ${bill.invoiceRef}: ${name ?? (e as Error).message.split("\n")[0]}`);
  }
}

async function tick() {
  for (const tag of tags) {
    const name = buildPayeeName(payeeFamily(), tag);
    const payee = await getVerifiedPayee(ens as never, name);
    const node = namehash(name);
    for (const bill of await openBills(arkiv, name, payee.biller)) {
      if (done.has(bill.digest)) continue;
      const [biller, balance, availableToPayee, availableToAgent] = await Promise.all([
        read("billerOf" as never, [sender, node] as never),
        read("balanceOf" as never, [sender] as never),
        read("availableToPayee" as never, [sender, node] as never),
        read("availableToAgent" as never, [sender, account.address] as never),
      ]) as [Address, bigint, bigint, bigint];
      const d = decide(bill, await checkBill(bill, payee), payee.biller, { biller, balance, availableToPayee, availableToAgent });
      if (!d.pay) {
        log(`hold ${bill.invoiceRef}: ${d.reason}`);
        continue;
      }
      if (!approved.has(bill.digest)) {
        const verdict = await reviewBill(reviewer, bill);
        if (verdict.hold) {
          log(`hold ${bill.invoiceRef} ${bill.digest}: ${verdict.reason}`);
          // A model hold stands until the sender acts, across restarts. A failed review is retried next tick.
          if (verdict.reason !== REVIEW_FAILED) {
            recordHold(HOLDS_FILE, bill.digest);
            done.add(bill.digest);
          }
          continue;
        }
      }
      await payBill(bill);
    }
  }
}

log(`agent ${account.address} paying for ${sender}: ${tags.join(", ")}`);
log(keys.length ? `AI review on, ${keys.length} Groq key(s)` : "AI review OFF: GROQ_API_KEYS is not set");
if (done.size) log(`${done.size} bill(s) on hold from earlier runs. Add a digest to APPROVED_DIGESTS to release it.`);
for (;;) {
  await tick().catch((e) => log("tick failed:", (e as Error).message.split("\n")[0]));
  await new Promise((r) => setTimeout(r, Number(process.env.POLL_SECONDS ?? 30) * 1000));
}
