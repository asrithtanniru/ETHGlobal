import type { Address, Hex } from "viem";
import { namehash } from "viem/ens";
import type { VerifiedPayee } from "@ghar/shared";

export type PayoutCheck = { ok: true } | { ok: false; reason: string };

/** Does this bill's name hash to the payee the vault locked funds for? */
export const billMatchesPayee = (billPayee: string, node: Hex) => namehash(billPayee) === node;

/** The provider's own check before paying out, from ENS and the vault, never from the agent. */
export function checkPayout(
  node: Hex,
  bill: { payee: string } | undefined,
  payee: VerifiedPayee | undefined,
  vaultBiller: Address,
): PayoutCheck {
  if (!bill) return { ok: false, reason: "no-arkiv-bill" };
  if (!billMatchesPayee(bill.payee, node)) return { ok: false, reason: "payee-mismatch" };
  if (!payee) return { ok: false, reason: "missing-ens-records" };
  if (payee.biller.toLowerCase() !== vaultBiller.toLowerCase()) return { ok: false, reason: "biller-changed" };
  return { ok: true };
}
