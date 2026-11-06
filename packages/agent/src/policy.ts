import { isAddressEqual, zeroAddress } from "viem";
import { isBillPayable } from "@ghar/ens";
import { PayoutStatus, type BillFacts, type Decision, type SignedBill } from "./types.ts";

/** The rules that authorize money. Pure code: no model output ever reaches this function. */
export function decide(bill: SignedBill, facts: BillFacts, nowSec: number): Decision {
  if (bill.amount <= 0n) return { action: "skip", reason: "zero-amount" };
  if (nowSec > bill.dueDate) return { action: "skip", reason: "expired" };
  if (facts.payoutStatus !== PayoutStatus.None) return { action: "skip", reason: "already-handled" };

  const check = isBillPayable({ payee: bill.payee, creator: bill.creator }, facts.payee, nowSec);
  if (!check.ok) return { action: "skip", reason: check.reason };

  if (isAddressEqual(facts.vaultBiller, zeroAddress)) return { action: "hold", reason: "payee-not-added" };
  if (!isAddressEqual(facts.vaultBiller, facts.payee.biller)) return { action: "hold", reason: "biller-changed" };
  if (bill.amount > facts.balance) return { action: "hold", reason: "low-balance" };
  if (bill.amount > facts.availableToAgent) return { action: "hold", reason: "over-agent-grant" };
  if (bill.amount > facts.availableToPayee) return { action: "hold", reason: "over-payee-cap" };
  return { action: "pay" };
}
