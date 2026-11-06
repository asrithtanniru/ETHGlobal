// Shows every bill posted under a payee name and whether the agent would accept it.
// Usage: npm run read-bills -w @ghar/arkiv -- <tag>
import { createPublicClient, http } from "viem";
import { ensChain, PAYEE_BOOK_PARENT } from "@ghar/shared";
import { buildPayeeName, getVerifiedPayee } from "@ghar/ens";
import { arkivClient, billsForPayee, checkBill } from "../src/index.ts";

const tag = process.argv[2];
if (!tag) throw new Error("usage: read-bills <tag>");
const ens = createPublicClient({ chain: ensChain, transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
const name = buildPayeeName(PAYEE_BOOK_PARENT, tag);
const payee = await getVerifiedPayee(ens as never, name);
const bills = await billsForPayee(arkivClient(), name);
console.log(`${name}: biller ${payee.biller}, ${bills.length} bill(s) on Arkiv`);
for (const b of bills) {
  const c = await checkBill(b, payee);
  console.log(`  ${c.ok ? "accept" : `ignore (${c.reason})`}  ${b.invoiceRef}  ${b.amount} base units  from ${b.creator}  ${b.key}`);
}
