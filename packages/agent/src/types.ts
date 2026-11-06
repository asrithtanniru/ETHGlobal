import type { Address, Hex } from "viem";
import type { Bill, VerifiedPayee } from "@ghar/shared";

/** An inbox bill plus the biller's EIP-712 signature the vault verifies. */
export type SignedBill = Bill & { signature: Hex };

/** The struct `GharVault.pay` takes. */
export interface VaultBill {
  payee: Hex;
  invoiceRef: Hex;
  amount: bigint;
  dueDate: bigint;
}

/** Same order as `GharVault.PayoutStatus`. */
export const PayoutStatus = { None: 0, Pending: 1, Paid: 2, Refunded: 3 } as const;

/** Everything `decide` needs, read fresh for each bill. */
export interface BillFacts {
  payee: VerifiedPayee;
  /** `billerOf` in the vault. Zero address if the sender never added this payee. */
  vaultBiller: Address;
  payoutStatus: number;
  balance: bigint;
  availableToAgent: bigint;
  availableToPayee: bigint;
}

/** skip: never payable. hold: the sender has to act. pay: all checks passed. */
export type Decision = { action: "pay" } | { action: "skip" | "hold"; reason: string };

export type Outcome =
  | { bill: SignedBill; action: "paid"; tx: Hex }
  | { bill: SignedBill; action: "would-pay" }
  | { bill: SignedBill; action: "skip" | "hold" | "error"; reason: string };

/** The inbox. Implemented by the Arkiv package; `fileBillSource` stands in until then. */
export interface BillSource {
  openBills(): Promise<SignedBill[]>;
}

export interface PayeeBook {
  read(name: string): Promise<VerifiedPayee>;
}

export interface Vault {
  readFacts(sender: Address, bill: VaultBill): Promise<Omit<BillFacts, "payee">>;
  /** Throws if `pay` would revert. */
  simulatePay(sender: Address, bill: VaultBill, signature: Hex): Promise<void>;
  pay(sender: Address, bill: VaultBill, signature: Hex): Promise<Hex>;
}

/** Second opinion on a bill the rules already passed. It can only hold, never approve. */
export interface Reviewer {
  review(bill: SignedBill, payee: VerifiedPayee): Promise<{ hold: false } | { hold: true; reason: string }>;
}
