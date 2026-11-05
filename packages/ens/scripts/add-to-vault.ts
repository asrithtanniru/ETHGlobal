// Sender adds a verified ENS payee to their vault. The biller is read from ENS, never typed in,
// so the vault only accepts bills signed by the wallet the provider verified.
// Usage: npm run add-to-vault -w @ghar/ens -- <tag> <capUsdt> [periodDays=30]
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash } from "viem/ens";
import { GHAR_VAULT, PAYEE_BOOK_PARENT, USDT, gharVaultAbi, settlementChain } from "@ghar/shared";
import { buildPayeeName, getVerifiedPayee } from "../src/index.ts";
import { env, publicClient as ensClient } from "./client.ts";

const [tag, capArg, daysArg = "30"] = process.argv.slice(2);
if (!tag || !capArg) throw new Error("usage: add-to-vault <tag> <capUsdt> [periodDays]");
const cap = parseUnits(capArg, USDT.decimals);
const days = Number(daysArg);
if (cap <= 0n || !Number.isInteger(days) || days <= 0) throw new Error("cap and periodDays must be positive");

const payee = await getVerifiedPayee(ensClient, buildPayeeName(PAYEE_BOOK_PARENT, tag));

// On testnet the deployer wallet plays the sender.
const sender = privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY") as Hex);
const chain = { chain: settlementChain, transport: http() } as const;
const vaultClient = createPublicClient(chain);
const wallet = createWalletClient({ ...chain, account: sender });
const vault = { address: GHAR_VAULT, abi: gharVaultAbi } as const;
const node = namehash(payee.name);

// One cap for both: at most `cap` per bill and per period.
const { request } = await vaultClient.simulateContract({
  ...vault, account: sender, functionName: "setPayee",
  args: [node, payee.biller, cap, cap, BigInt(days * 24 * 60 * 60)],
});
const hash = await wallet.writeContract(request);
const receipt = await vaultClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`setPayee failed: ${hash}`);

const biller = await vaultClient.readContract({ ...vault, functionName: "billerOf", args: [sender.address, node] });
const available = await vaultClient.readContract({ ...vault, functionName: "availableToPayee", args: [sender.address, node] });
if (biller !== payee.biller) throw new Error(`vault biller ${biller} != ENS biller ${payee.biller}`);
console.log(`${payee.name} added to vault for ${sender.address}
  node      ${node}
  biller    ${biller} (matches ENS)
  cap       ${capArg} USDT per ${days} days, available now ${Number(available) / 10 ** USDT.decimals}
  tx        ${hash}`);
