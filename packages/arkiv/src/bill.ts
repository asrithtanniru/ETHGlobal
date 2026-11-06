import { ExpirationTime } from "@arkiv-network/sdk";
import { bytes, str, u256, u64 } from "@arkiv-network/sdk/schema";
import { hashTypedData, keccak256, recoverTypedDataAddress, stringToBytes, type Address, type Hex } from "viem";
import { namehash } from "viem/ens";
import { GHAR_VAULT, settlementChain } from "@ghar/shared";
import { isBillPayable, type PayeeState } from "@ghar/ens";

/** What a biller fills in. */
export interface BillInput {
  payee: string;
  invoiceRef: string;
  /** USDT base units (6 decimals). */
  amount: bigint;
  /** Unix seconds. */
  dueDate: number;
}

/** A bill read back from Arkiv. */
export interface InboxBill extends BillInput {
  key: Hex;
  creator: Address;
  currency: string;
  digest: Hex;
  signature: Hex;
  note?: string;
}

const types = {
  Bill: [
    { name: "payee", type: "bytes32" },
    { name: "invoiceRef", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "dueDate", type: "uint64" },
  ],
} as const;

/** The struct pay() takes. */
export function toVaultBill(b: BillInput) {
  return {
    payee: namehash(b.payee),
    invoiceRef: keccak256(stringToBytes(b.invoiceRef)),
    amount: b.amount,
    dueDate: BigInt(b.dueDate),
  };
}

/** EIP-712 payload the biller signs. Bound to one vault and chain, as GharVault.billDigest is. */
export function billTypedData(b: BillInput, vault: Address = GHAR_VAULT) {
  return {
    domain: { name: "Ghar", version: "1", chainId: settlementChain.id, verifyingContract: vault },
    types,
    primaryType: "Bill",
    message: toVaultBill(b),
  } as const;
}

export const billDigest = (b: BillInput, vault: Address = GHAR_VAULT) => hashTypedData(billTypedData(b, vault));

/**
 * GharBill values and options for a signed bill. Create the entity from the biller's own wallet,
 * so its $creator is the biller; the agent ignores bills from anyone else.
 */
export function billEntity(bill: BillInput & { currency: string; note?: string }, signature: Hex) {
  const values = {
    payee: str(bill.payee), invoiceRef: str(bill.invoiceRef), currency: str(bill.currency),
    dueDate: u64(bill.dueDate), digest: str(billDigest(bill)), amount: u256(bill.amount), signature: bytes(signature),
    ...(bill.note ? { note: str(bill.note) } : {}),
  };
  const options = {
    // Kept 7 days past due so the family can still read it; the vault refuses it after the due date.
    expiration: ExpirationTime.atDate(new Date(bill.dueDate * 1000 + 7 * 86_400_000), { atLeast: ExpirationTime.fromDays(1) }),
    flags: { readonly: true },
  };
  return { values, options };
}

export type BillCheck = { ok: true } | { ok: false; reason: string };

/**
 * Full check of an inbox bill against the payee's ENS records. Arkiv's creator stops fake posters;
 * the signature stops a changed amount or due date; the vault repeats the signature check and
 * refuses a digest it has already paid.
 */
export async function checkBill(
  bill: InboxBill,
  payee: PayeeState,
  nowSec: number = Math.floor(Date.now() / 1000),
  vault: Address = GHAR_VAULT,
): Promise<BillCheck> {
  const guard = isBillPayable({ payee: bill.payee, creator: bill.creator }, payee, nowSec);
  if (!guard.ok) return guard;
  if (bill.dueDate < nowSec) return { ok: false, reason: "past-due" };
  if (billDigest(bill, vault) !== bill.digest) return { ok: false, reason: "digest-mismatch" };
  try {
    const signer = await recoverTypedDataAddress({ ...billTypedData(bill, vault), signature: bill.signature });
    if (signer.toLowerCase() !== payee.biller.toLowerCase()) return { ok: false, reason: "wrong-signature" };
  } catch {
    return { ok: false, reason: "bad-signature" };
  }
  return { ok: true };
}
