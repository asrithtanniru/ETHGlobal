// Run by the payout provider's verifier: writes a payee's verified records.
// Usage: npm run set-payee -w @ghar/ens -- <label> <payoutRef> <billerAddress>
import { createWalletClient, getAddress, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalize, packetToBytes } from "viem/ens";
import { PAYEE_BOOK_PARENT, PAYEE_BOOK_RESOLVER, ensChain } from "@ghar/shared";
import { env, publicClient, resolverAbi, transport } from "./client.ts";

const [label, payoutRef, billerArg] = process.argv.slice(2);
if (!label || !payoutRef || !billerArg) {
  throw new Error("usage: set-payee <label> <payoutRef> <billerAddress>");
}
const biller = getAddress(billerArg); // rejects malformed or wrongly checksummed addresses
const name = normalize(`${label}.${PAYEE_BOOK_PARENT}`);
const verifier = privateKeyToAccount(env("VERIFIER_PRIVATE_KEY") as Hex);
const wallet = createWalletClient({ account: verifier, chain: ensChain, transport });

for (const [key, value] of [["payout", payoutRef], ["biller", biller]] as const) {
  const hash = await wallet.writeContract({
    address: PAYEE_BOOK_RESOLVER, abi: resolverAbi, functionName: "setText",
    args: [toHex(packetToBytes(name)), key, value],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`setText ${key} failed: ${hash}`);
  console.log(`${name} ${key} = ${value} (${hash})`);
}
