// Gasless deposits: the sender signs an EIP-3009 ReceiveWithAuthorization for the vault, and Kin's
// relayer submits GharVault.depositWithAuthorization and pays the gas. Shared by the browser and the relayer.
import { isAddress, isHex, getAddress, type Address, type Hex } from "viem";
import { GHAR_VAULT, USDT, settlementChain } from "@ghar/shared";

/** The Whitechain test USDT's EIP-712 domain (checked against its DOMAIN_SEPARATOR). */
export const usdtDomain = { name: "Tether USD", version: "1", chainId: settlementChain.id, verifyingContract: USDT.address } as const;

const types = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** What the sender's wallet signs. `to` is always the vault, so the signature can't move funds anywhere else. */
export const depositTypedData = (from: Address, value: bigint, validBefore: bigint, nonce: Hex) =>
  ({ domain: usdtDomain, types, primaryType: "ReceiveWithAuthorization", message: { from, to: GHAR_VAULT, value, validAfter: 0n, validBefore, nonce } }) as const;

/** Smallest relayed deposit: each relay must move real USDT of the signer's own. */
export const RELAY_MIN = 1_000_000n;
/** How long a signed deposit stays valid. */
export const RELAY_WINDOW = 3600;

export type DepositAuth = { from: Address; value: bigint; validBefore: bigint; nonce: Hex; signature: Hex };

/** Shape and policy checks the relayer runs before it reads the chain or spends gas. */
export function parseDepositAuth(body: unknown, nowSec: number): DepositAuth | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.from !== "string" || !isAddress(b.from, { strict: false })) return { error: "Bad wallet address." };
  if (typeof b.value !== "string" || !/^\d{1,13}$/.test(b.value)) return { error: "Bad amount." };
  if (typeof b.validBefore !== "string" || !/^\d{1,12}$/.test(b.validBefore)) return { error: "Bad expiry." };
  if (typeof b.nonce !== "string" || !isHex(b.nonce) || b.nonce.length !== 66) return { error: "Bad nonce." };
  if (typeof b.signature !== "string" || !isHex(b.signature) || b.signature.length !== 132) return { error: "Bad signature." };
  const value = BigInt(b.value), validBefore = BigInt(b.validBefore);
  if (value < RELAY_MIN) return { error: "Deposits without gas start at 1 USDT." };
  if (validBefore <= BigInt(nowSec + 60) || validBefore > BigInt(nowSec + RELAY_WINDOW + 60)) return { error: "This signed deposit has expired or lasts too long. Sign again." };
  return { from: getAddress(b.from), value, validBefore, nonce: b.nonce as Hex, signature: b.signature as Hex };
}
