import type { Address } from "viem";
import { toVaultBill } from "./bill.ts";
import { decide } from "./policy.ts";
import type { BillSource, Outcome, PayeeBook, Reviewer, SignedBill, Vault } from "./types.ts";

export interface AgentDeps {
  sender: Address;
  bills: BillSource;
  payees: PayeeBook;
  vault: Vault;
  reviewer: Reviewer;
  /** Run every check including the simulation, but send nothing. */
  dryRun: boolean;
  now?: () => number;
}

async function processBill(bill: SignedBill, deps: AgentDeps): Promise<Outcome> {
  const { sender, payees, vault, reviewer, dryRun } = deps;
  const nowSec = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const vaultBill = toVaultBill(bill);

  const [payee, facts] = await Promise.all([payees.read(bill.payee), vault.readFacts(sender, vaultBill)]);
  const decision = decide(bill, { ...facts, payee }, nowSec);
  if (decision.action !== "pay") return { bill, action: decision.action, reason: decision.reason };

  // A failed review holds the bill: no opinion is never treated as approval.
  const review = await reviewer.review(bill, payee).catch(() => ({ hold: true, reason: "review-failed" }) as const);
  if (review.hold) return { bill, action: "hold", reason: review.reason };

  await vault.simulatePay(sender, vaultBill, bill.signature);
  if (dryRun) return { bill, action: "would-pay" };
  return { bill, action: "paid", tx: await vault.pay(sender, vaultBill, bill.signature) };
}

/** One pass over the inbox. A failure on one bill never stops the rest. */
export async function runOnce(deps: AgentDeps): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const bill of await deps.bills.openBills()) {
    outcomes.push(
      await processBill(bill, deps).catch((e: unknown) => ({
        bill,
        action: "error" as const,
        reason: e instanceof Error ? e.message : String(e),
      })),
    );
  }
  return outcomes;
}
