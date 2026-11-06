import type { Address } from "viem";
import type { BillCheck, InboxBill } from "@ghar/arkiv";

/** What the vault says about this sender, agent and payee right now. */
export interface VaultView {
  /** billerOf(sender, payee): the wallet the sender accepted when adding the payee. */
  biller: Address;
  /** spendableOf(sender): the balance plus any stake, which returns when a payment needs it. */
  balance: bigint;
  availableToPayee: bigint;
  availableToAgent: bigint;
}

export type Decision = { pay: true } | { pay: false; reason: string };

/** Pure policy: a bill is paid only if every off-chain check and every vault limit allows it. */
export function decide(bill: InboxBill, check: BillCheck, ensBiller: Address, vault: VaultView): Decision {
  if (!check.ok) return { pay: false, reason: check.reason };
  // billerOf reads as zero for a payee the sender never added.
  if (/^0x0{40}$/.test(vault.biller)) return { pay: false, reason: "not-in-vault" };
  if (vault.biller.toLowerCase() !== ensBiller.toLowerCase()) return { pay: false, reason: "vault-biller-differs-from-ens" };
  if (bill.amount > vault.availableToAgent) return { pay: false, reason: "over-agent-grant" };
  if (bill.amount > vault.availableToPayee) return { pay: false, reason: "over-payee-cap" };
  if (bill.amount > vault.balance) return { pay: false, reason: "balance-too-low" };
  return { pay: true };
}
