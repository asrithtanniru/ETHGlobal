/**
 * Payee record reads and writes, following the docs app-developers guide:
 * reads via viem's built-in Universal Resolver (never a hardcoded address),
 * writes via a fresh `getEnsResolver` lookup + DNS-encoded `setText` batch.
 */
import {
  encodeFunctionData,
  isAddress,
  parseAbi,
  toHex,
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { normalize, packetToBytes } from "viem/ens";
import type { VerifiedPayee } from "@ghar/shared";

export const PAYOUT_KEY = "ghar.payoutRef";
export const BILLER_KEY = "ghar.biller";

const resolverAbi = parseAbi([
  "function setText(bytes name, string key, string value)",
  "function multicall(bytes[] data)",
]);

/** Read both payee keys through the library Universal Resolver. */
export async function getVerifiedPayee(client: PublicClient, payee: string): Promise<VerifiedPayee> {
  const name = normalize(payee);
  const [payoutRef, biller] = await Promise.all([
    client.getEnsText({ name, key: PAYOUT_KEY }),
    client.getEnsText({ name, key: BILLER_KEY }),
  ]);
  if (!payoutRef || !biller || !isAddress(biller)) throw new Error(`missing payee records: ${name}`);
  return { name, payoutRef, biller };
}

/** Write both keys in one multicall to the resolver the name uses right now. */
export async function setVerifiedPayee(
  publicClient: PublicClient,
  wallet: WalletClient<Transport, Chain, Account>,
  payee: VerifiedPayee,
): Promise<`0x${string}`> {
  const name = normalize(payee.name);
  const resolverAddress = await publicClient.getEnsResolver({ name });
  if (!resolverAddress) throw new Error(`no resolver for ${name}`);
  const dnsName = toHex(packetToBytes(name));
  return wallet.writeContract({
    address: resolverAddress,
    abi: resolverAbi,
    functionName: "multicall",
    args: [
      [
        encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsName, PAYOUT_KEY, payee.payoutRef] }),
        encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsName, BILLER_KEY, payee.biller] }),
      ],
    ],
    account: wallet.account,
    chain: wallet.chain,
  });
}
