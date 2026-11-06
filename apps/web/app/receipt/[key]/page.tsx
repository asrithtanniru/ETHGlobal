import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isHash, type Hex } from "viem";
import { billByDigest, receiptByKey } from "@ghar/arkiv";
import { PrintedReceipt } from "@/components/PrintedReceipt";
import { explorerTx, short, usdt, when } from "@/lib/chain";
import { arkiv, providerWallet } from "@/lib/inbox";

export const metadata: Metadata = { title: "Ghar · Receipt" };
export const dynamic = "force-dynamic";

/** Public page the family opens from a link. No wallet needed. */
export default async function Receipt({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isHash(key)) notFound();
  const client = arkiv();
  const provider = await providerWallet();
  const receipt = await receiptByKey(client, key as Hex, provider);
  if (!receipt) notFound();
  const bill = await billByDigest(client, receipt.digest);
  const paid = receipt.status === "paid";
  const amount = bill ? `${usdt(bill.amount)} USDT` : "—";
  return (
    <PrintedReceipt
      heading={paid ? "This bill was paid." : "This bill was refunded."}
      lede={paid ? `${receipt.fiat ?? "The payout"} reached ${receipt.payee}.` : "The provider couldn't pay out, so the USDT went back to the sender's balance."}
      title={receipt.payee}
      detail={bill?.invoiceRef ?? "—"}
      amount={amount}
      reference={short(receipt.key)}
    >
      <p className="slip__head"><span>Receipt</span><span>{short(receipt.key)}</span></p>
      <dl className="slip__rows">
        {[
          ["payee", receipt.payee],
          ["invoice", bill?.invoiceRef ?? "—"],
          ...(bill ? [["due", when(bill.dueDate)]] : []),
          ["status", receipt.status],
          [paid ? "order" : "reason", receipt.providerRef],
          ["provider", short(receipt.creator)],
        ].map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <p className="slip__total"><span>{paid ? "Paid" : "Refunded"}</span><strong>{amount}</strong></p>
      <a className="link" href={explorerTx(receipt.settlementTx)} target="_blank" rel="noreferrer">See the settlement on Whitechain <span aria-hidden="true">→</span></a>
    </PrintedReceipt>
  );
}
