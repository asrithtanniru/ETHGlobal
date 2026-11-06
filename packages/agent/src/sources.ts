import { readFile } from "node:fs/promises";
import type { BillSource, Reviewer, SignedBill } from "./types.ts";

/** Reads bills from a JSON file (`amount` as a string). Stands in until the Arkiv source lands. */
export function fileBillSource(path: string): BillSource {
  return {
    async openBills() {
      const rows = JSON.parse(await readFile(path, "utf8")) as (Omit<SignedBill, "amount"> & { amount: string })[];
      return rows.map((row) => ({ ...row, amount: BigInt(row.amount) }));
    },
  };
}

/** Holds nothing. The AI reviewer replaces this. */
export const noReview: Reviewer = { review: async () => ({ hold: false }) };
