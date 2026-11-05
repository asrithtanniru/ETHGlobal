import type { Address, Hash } from "viem";

/**
 * A bill posted by a payee to the Arkiv inbox. The agent only acts on a bill whose
 * creator matches the `biller` record on the payee's ENS name.
 */
export interface Bill {
  /** Arkiv entity key. */
  key: Hash;
  /** Wallet that created the entity. Set by Arkiv and cannot be forged. */
  creator: Address;
  /** ENS name of the payee, for example "rent.you.eth". */
  payee: string;
  /** Payee's own invoice reference, unique per payee. */
  invoiceRef: string;
  /** ISO 4217 code of the local currency the payee is owed, for example "INR". */
  currency: string;
  /** Amount owed, in USDT base units (6 decimals). */
  amount: bigint;
  /** Unix timestamp (seconds) the bill is due. */
  dueDate: number;
  note?: string;
}

/** What a payee's ENS name points to. Only the provider's verifier can write these records. */
export interface VerifiedPayee {
  name: string;
  /** Provider's reference to the KYC-verified bank account the payout goes to. */
  payoutRef: string;
  /** Wallet allowed to post bills for this payee. */
  biller: Address;
}

export type ReceiptStatus = "paid" | "refunded";

/** Written to Arkiv by the payout provider once the local-currency payout settles. */
export interface Receipt {
  billKey: Hash;
  /** Whitechain transaction that moved the USDT. */
  settlementTx: Hash;
  status: ReceiptStatus;
}
