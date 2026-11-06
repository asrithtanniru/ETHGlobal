// Run by the payout provider's verifier: writes a payee's verified records.
// Usage: npm run set-payee -w @ghar/ens -- <tag> <payoutRef> <billerAddress>
import { createWalletClient, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ensChain } from "@ghar/shared";
import { buildPayeeName, payeeFamily, setVerifiedPayee } from "../src/index.ts";
import { env, publicClient, transport } from "./client.ts";

const [tag, payoutRef, billerArg] = process.argv.slice(2);
if (!tag || !payoutRef || !billerArg) {
  throw new Error("usage: set-payee <tag> <payoutRef> <billerAddress>");
}
const payee = {
  name: buildPayeeName(payeeFamily(), tag),
  payoutRef,
  biller: getAddress(billerArg), // rejects malformed or wrongly checksummed addresses
};
const verifier = privateKeyToAccount(env("VERIFIER_PRIVATE_KEY") as Hex);
const wallet = createWalletClient({ account: verifier, chain: ensChain, transport });

const hash = await setVerifiedPayee(publicClient, wallet, payee);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`setVerifiedPayee failed: ${hash}`);
console.log(`${payee.name} payoutRef=${payee.payoutRef} biller=${payee.biller} (${hash})`);
