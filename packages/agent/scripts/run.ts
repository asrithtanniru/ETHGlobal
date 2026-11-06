// One agent pass over the inbox. Simulates only unless --live is passed.
// Settings come from packages/agent/.env (see .env.example).
// Usage: npm run run -w @ghar/agent-core -- [--live] [--no-review]
import { createPublicClient, createWalletClient, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ensChain, settlementChain } from "@ghar/shared";
import {
  ensPayeeBook, fileBillSource, groqEndpoints, llmReviewer, noReview, parseKeys, runOnce, vaultPastAmounts, whitechainVault,
} from "../src/index.ts";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const live = process.argv.includes("--live");
const keys = parseKeys(process.env.GROQ_API_KEYS);
// Forgetting the keys must not quietly turn the review off for real payments.
if (live && keys.length === 0 && !process.argv.includes("--no-review")) {
  throw new Error("GROQ_API_KEYS is not set. Pass --no-review to pay without the AI review.");
}

const account = privateKeyToAccount(env("AGENT_PRIVATE_KEY") as Hex);
const settlement = { chain: settlementChain, transport: http() } as const;
const ensClient = createPublicClient({
  chain: ensChain,
  transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
});

const sender = getAddress(env("SENDER_ADDRESS"));
const vaultClient = createPublicClient(settlement);

const outcomes = await runOnce({
  sender,
  bills: fileBillSource(env("BILLS_FILE")),
  payees: ensPayeeBook(ensClient),
  vault: whitechainVault(vaultClient, createWalletClient({ ...settlement, account })),
  reviewer: keys.length
    ? llmReviewer({ endpoints: groqEndpoints(keys), pastAmounts: vaultPastAmounts(vaultClient, sender) })
    : noReview,
  dryRun: !live,
});

for (const o of outcomes) {
  const detail = "reason" in o ? o.reason : "tx" in o ? o.tx : "";
  console.log(`${o.action.padEnd(9)} ${o.bill.payee} ${o.bill.invoiceRef} ${detail}`);
}
