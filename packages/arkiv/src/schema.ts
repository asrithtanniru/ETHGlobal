import { bytes, defineSchema, str, u256, u64 } from "@arkiv-network/sdk/schema";

/**
 * A bill in the Arkiv inbox, posted from the biller's own wallet.
 * Every attribute is public: keep names, account numbers and other personal data out of `note`.
 * Indexed columns are the ones the agent and the app filter on.
 */
export const GharBill = defineSchema("ghar_bill", {
  /** ENS name of the payee, for example rent.gharfam.eth. */
  payee: str().indexed(),
  /** Payee's own invoice reference. */
  invoiceRef: str().indexed(),
  /** ISO 4217 code of the local currency the payee is owed. */
  currency: str().indexed(),
  /** Unix seconds. The vault refuses the bill after this time. */
  dueDate: u64().indexed(),
  /** EIP-712 digest of the bill, the id the vault and the receipt use. */
  digest: str().indexed(),
  /** USDT base units (6 decimals). */
  amount: u256(),
  /** The biller's EIP-712 signature; the vault's pay() needs it. */
  signature: bytes(),
  note: str().optional(),
});

/** Written by the payout provider once a payout settles, so the family can read the outcome. */
export const GharReceipt = defineSchema("ghar_receipt", {
  /** The bill's EIP-712 digest. */
  digest: str().indexed(),
  /** Arkiv entity key of the bill. */
  billKey: str().indexed(),
  payee: str().indexed(),
  /** "paid" or "refunded". */
  status: str().indexed(),
  /** Whitechain transaction that settled the USDT. */
  settlementTx: str(),
  /** Provider order id, or the refund reason. */
  providerRef: str(),
  /** Delivered amount as the provider reported it, for example "40.10 USD". */
  fiat: str().optional(),
});
