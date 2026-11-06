// Biller posts a signed bill to the Arkiv inbox from its own wallet.
// Usage: npm run post-bill -w @ghar/arkiv -- <tag> <amountUsdt> <dueInDays> <invoiceRef> [currency=USD] [note]
import { parseUnits, type Hex } from "viem";
import { USDT } from "@ghar/shared";
import { buildPayeeName, payeeFamily } from "@ghar/ens";
import { billDigest } from "../src/bill.ts";
import { postBill } from "../src/write.ts";

const [tag, amount, days, invoiceRef, currency = "USD", note] = process.argv.slice(2);
if (!tag || !amount || !days || !invoiceRef) throw new Error("usage: post-bill <tag> <amountUsdt> <dueInDays> <invoiceRef> [currency] [note]");

const bill = {
  payee: buildPayeeName(payeeFamily(), tag),
  invoiceRef,
  amount: parseUnits(amount, USDT.decimals),
  dueDate: Math.floor(Date.now() / 1000) + Number(days) * 86_400,
  currency,
  ...(note ? { note } : {}),
};
const r = await postBill({
  accessKey: process.env.ARKIV_ACCESS_KEY ?? "",
  privateKey: process.env.BILLER_PRIVATE_KEY as Hex,
  maxCostWei: BigInt(process.env.ARKIV_MAX_FEE_WEI ?? "0"),
  journal: ".arkiv-journal.jsonl",
}, bill);
console.log(`posted ${bill.invoiceRef} for ${bill.payee}
  entity   ${r.entityKey}
  digest   ${billDigest(bill)}
  tx       https://rabdi.explorer.arkiv.network/tx/${r.txHash}
  expires  block ${r.expiresAt}`);
