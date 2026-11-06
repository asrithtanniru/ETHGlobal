// Ghar agent: reads open bills from Arkiv for each payee, checks them against ENS and the vault,
// then pays with pay(). Deterministic rules: the vault enforces the same limits on-chain anyway.
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash } from "viem/ens";
import { ensChain, GHAR_VAULT, gharVaultAbi, PAYEE_BOOK_PARENT, settlementChain, USDT } from "@ghar/shared";
import { buildPayeeName, getVerifiedPayee } from "@ghar/ens";
import { arkivClient, checkBill, openBills, toVaultBill, type InboxBill } from "@ghar/arkiv";
import { decide } from "./decide.ts";

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
const done = new Set<string>(); // digests already settled or refused for good this run

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
    const name = buildPayeeName(PAYEE_BOOK_PARENT, tag);
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
      if (d.pay) await payBill(bill);
      else log(`hold ${bill.invoiceRef}: ${d.reason}`);
    }
  }
}

log(`agent ${account.address} paying for ${sender}: ${tags.join(", ")}`);
for (;;) {
  await tick().catch((e) => log("tick failed:", (e as Error).message.split("\n")[0]));
  await new Promise((r) => setTimeout(r, Number(process.env.POLL_SECONDS ?? 30) * 1000));
}
