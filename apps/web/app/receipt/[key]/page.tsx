import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isHash, type Hex } from "viem";
import { billByDigest, receiptByKey } from "@ghar/arkiv";
import { Logo } from "@/components/ui";
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
  return (
    <>
      <section className="band band--rule">
        <div className="frame" style={{ padding: "2.4rem var(--pad)" }}><Logo /></div>
      </section>
      <section className="band band--rule">
        <div className="frame page-head">
          <p className="eyebrow">Receipt</p>
          <h1 className="display-s">{paid ? "This bill was paid." : "This bill was refunded."}</h1>
          <p className="body-l">
            {paid ? `${receipt.fiat ?? "The payout"} reached ${receipt.payee}.` : "The provider couldn't pay out, so the USDT went back to the sender's balance."}
          </p>
        </div>
      </section>
      <section className="band band--rule">
        <div className="frame panel">
          <div className="record" style={{ marginTop: 0 }}>
            <div className="record__head">
              <span className="mono">Receipt</span>
              <span className="mono">{short(receipt.key)}</span>
            </div>
            <div className="record__rows">
              {[
                ["payee", receipt.payee],
                ["invoice", bill?.invoiceRef ?? "—"],
                ["amount", bill ? `${usdt(bill.amount)} USDT` : "—"],
                ...(bill ? [["due", when(bill.dueDate)]] : []),
                ["status", receipt.status],
                [paid ? "order" : "reason", receipt.providerRef],
                ["provider", short(receipt.creator)],
              ].map(([k, v]) => (
                <div className="record__row mono" key={k}><span /><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
            <div className="record__foot">
              <a className="link" href={explorerTx(receipt.settlementTx)} target="_blank" rel="noreferrer">See the settlement on Whitechain <span aria-hidden="true">→</span></a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
