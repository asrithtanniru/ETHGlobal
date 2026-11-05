import type { Address } from "viem";
import type { VerifiedPayee } from "@ghar/shared";
import { isExpired } from "./names.js";

export interface PayeeState extends VerifiedPayee {
  expiry?: number;
  revoked?: boolean;
}

/** Agent read check: bill counts only if creator matches the ENS biller record. */
export function isBillPayable(
  args: { payee: string; creator: Address },
  state: PayeeState,
  nowSec: number = Math.floor(Date.now() / 1000),
): { ok: true } | { ok: false; reason: string } {
  if (args.payee.toLowerCase() !== state.name.toLowerCase()) return { ok: false, reason: "payee-mismatch" };
  if (args.creator.toLowerCase() !== state.biller.toLowerCase()) return { ok: false, reason: "wrong-biller" };
  if (state.revoked) return { ok: false, reason: "revoked" };
  if (state.expiry !== undefined && isExpired(state.expiry, nowSec)) return { ok: false, reason: "expired" };
  return { ok: true };
}
