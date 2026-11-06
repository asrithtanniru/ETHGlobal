import { keccak256, toBytes, type Address } from "viem";
import { namehash } from "viem/ens";
import { GHAR_VAULT, settlementChain, type Bill } from "@ghar/shared";
import type { VaultBill } from "./types.ts";

/** Converts an inbox bill to the struct the vault hashes and pays. */
export function toVaultBill(bill: Pick<Bill, "payee" | "invoiceRef" | "amount" | "dueDate">): VaultBill {
  return {
    payee: namehash(bill.payee),
    invoiceRef: keccak256(toBytes(bill.invoiceRef)),
    amount: bill.amount,
    dueDate: BigInt(bill.dueDate),
  };
}

/** Typed data the biller signs. Pass to `signTypedData` when posting a bill. */
export function billTypedData(bill: VaultBill, vault: Address = GHAR_VAULT) {
  return {
    domain: { name: "Ghar", version: "1", chainId: settlementChain.id, verifyingContract: vault },
    types: {
      Bill: [
        { name: "payee", type: "bytes32" },
        { name: "invoiceRef", type: "bytes32" },
        { name: "amount", type: "uint256" },
        { name: "dueDate", type: "uint64" },
      ],
    },
    primaryType: "Bill",
    message: bill,
  } as const;
}
