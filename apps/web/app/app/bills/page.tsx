"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PAYEE_BOOK_PARENT } from "@ghar/shared";
import { PageHead } from "@/components/app/AppShell";
import { short, usdt, when } from "@/lib/chain";

type Row = {
  key: string; creator: string; invoiceRef: string; currency: string; amount: string; dueDate: number; note?: string;
  check: { ok: true } | { ok: false; reason: string }; receiptKey?: string; receiptStatus?: string;
};
type Inbox = { payee: { name: string; biller: string; payoutRef: string }; bills: Row[] };

const REASONS: Record<string, string> = {
  "wrong-biller": "Posted by a wallet that isn't this payee's biller",
  "wrong-signature": "Signed by the wrong wallet",
  "bad-signature": "The signature can't be read",
  "digest-mismatch": "The amount or date doesn't match what was signed",
  "past-due": "Past its due date",
  "payee-mismatch": "Posted for a different payee",
  revoked: "This payee was revoked",
  expired: "This payee's name expired",
};

export default function Bills() {
  const [input, setInput] = useState(`rent.${PAYEE_BOOK_PARENT}`);
  const [payee, setPayee] = useState(input);
  const q = useQuery({
    queryKey: ["inbox", payee],
    queryFn: async (): Promise<Inbox> => {
      const r = await fetch(`/api/bills?payee=${encodeURIComponent(payee)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j;
    },
    retry: false,
  });
  return (
    <div className="page">
      <PageHead title="Bills">Anyone can post to the public Arkiv inbox. The agent only accepts a bill from the wallet in the payee&apos;s ENS record, with a signature that matches.</PageHead>
      <div className="stack">
        <form className="card lookup" onSubmit={(e) => { e.preventDefault(); setPayee(input.trim().toLowerCase()); }}>
          <div className="field">
            <label htmlFor="bp">Payee name</label>
            <input id="bp" value={input} onChange={(e) => setInput(e.target.value)} />
          </div>
          <button className="btn btn--ghost" disabled={!input.trim()}>Read inbox</button>
        </form>
        <section className="card card--list">
          {q.data && (
            <div className="card__top">
              <h2 className="card__h">{q.data.payee.name}</h2>
              <dl className="kv"><dt>biller from ENS</dt><dd>{q.data.payee.biller}</dd></dl>
            </div>
          )}
          {q.isLoading && <p className="empty">Reading Arkiv<span className="dots" /></p>}
          {q.error && <p className="empty msg--err">{(q.error as Error).message}</p>}
          {q.data?.bills.length === 0 && <p className="empty">No bills posted for this payee yet.</p>}
          {q.data?.bills.map((b) => (
            <div className="list-row" key={b.key}>
              <div>
                <div className="title">{usdt(BigInt(b.amount))} USDT</div>
                <div className="mono" style={{ marginTop: "0.4rem" }}>{b.invoiceRef} · {b.currency}</div>
              </div>
              <div className="body-l">
                <span className={`tag-pill ${b.check.ok ? "tag-pill--on" : ""}`}>{b.check.ok ? "accepted" : "ignored"}</span>{" "}
                {b.check.ok ? <>due {when(b.dueDate)}</> : REASONS[b.check.reason] ?? b.check.reason}
                <div className="mono" style={{ marginTop: "0.4rem" }}>from {short(b.creator)}{b.note ? ` · ${b.note}` : ""}</div>
              </div>
              {b.receiptKey ? <Link className="link" href={`/receipt/${b.receiptKey}`}>{b.receiptStatus} receipt <span aria-hidden="true">→</span></Link> : <span />}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
