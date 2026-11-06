import { BaseError, ContractFunctionRevertedError, type Address, type Hex } from "viem";
import { namehash } from "viem/ens";
import type { VerifiedPayee } from "@ghar/shared";

export type PayoutCheck = { ok: true } | { ok: false; reason: string };

/** Does this bill's name hash to the payee the vault locked funds for? */
export const billMatchesPayee = (billPayee: string, node: Hex) => namehash(billPayee) === node;

/** True only when ENS answered that the records aren't there, not when it failed to answer. */
export function isMissingPayee(e: unknown) {
  if (e instanceof Error && e.message.startsWith("missing payee records")) return true;
  const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
  return revert instanceof ContractFunctionRevertedError && revert.data?.errorName === "ResolverNotFound";
}

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
