"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Logo } from "@/components/ui";
import type { ClaimView } from "@/lib/directShared";

const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
const WC = "https://explorer.testnet.whitechain.io/tx/";
const STAGE: Record<string, string> = {
  processing: "Transak is processing your payout",
  "deposit-sent": "The provider has paid Transak. Your money is on its way",
  "deposit-uncertain": "The payout needs a manual check by the provider. Your money is safe in escrow",
  "amount-mismatch": "Transak asked for a different amount, so nothing was sent. The provider will refund it",
  "review-failed": "This send didn't pass the provider's checks and will be refunded to the sender",
  "receipt-pending": "Paid. The receipt is being posted",
};

export default function ClaimPage() {
  return <main className="claim"><Suspense><Claim /></Suspense></main>;
}

function Claim() {
  const { digest } = useParams<{ digest: string }>();
  const token = useSearchParams().get("t") ?? "";
  const [view, setView] = useState<ClaimView | null>(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      const r = await fetch(`/api/direct/claim?digest=${digest}&t=${encodeURIComponent(token)}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as ClaimView & { error?: string };
      if (stop) return;
      if (!r.ok) setError(j.error ?? "Couldn't read this claim."); else { setError(""); setView(j); }
      if (r.ok && (j.status === "paid" || j.status === "refunded")) return;
      setTimeout(() => { if (!stop) load(); }, 5000);
    }
    load();
    return () => { stop = true; };
  }, [digest, token]);

  async function claim() {
    setOpening(true);
    const r = await fetch("/api/direct/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest, t: token }) });
    const j = (await r.json().catch(() => ({}))) as { widgetUrl?: string; error?: string };
    if (j.widgetUrl) window.location.href = j.widgetUrl;
    else { setError(j.error ?? "Couldn't open Transak."); setOpening(false); }
  }

  const waiting = view?.status === "pending" && (!view.stage || view.stage === "awaiting-widget");
  return (
    <div className="claim__panel">
      <Logo />
      {!view && !error && <p className="shimmer">Opening your claim</p>}
      {error && !view && <p className="msg msg--err">{error}</p>}
      {view && (
        <section className="card claim__card">
          <p className="mono claim__k">{view.status === "paid" ? "PAID OUT" : view.status === "refunded" ? "REFUNDED" : "MONEY SENT TO YOU"}</p>
          <p className="claim__amt">{view.amountUsdt}<small>USDT</small></p>
          <p className="card__p">From <span className="mono">{view.from}</span>, to claim as <b>{view.currency}</b> to your card or bank.</p>
          {view.status === "unpaid" && <p className="msg">The sender hasn&apos;t finished sending this yet.</p>}
          {waiting && (view.expired
            ? <p className="msg msg--err">This claim link has expired. Ask the sender to send again; their money goes back to their vault.</p>
            : <>
              <p className="card__p">Sign in to Transak with <span className="mono">{view.email}</span>, verify yourself and add your card or bank. You come back here when it&apos;s done.</p>
              <div className="form-actions"><button className="btn" disabled={opening} onClick={claim}>{opening ? "Opening Transak" : "Claim with Transak"}</button></div>
            </>)}
          {view.status === "pending" && !waiting && <p className="msg" aria-live="polite">{STAGE[view.stage ?? ""] ?? "Working on it"}{view.orderStatus ? ` (${view.orderStatus})` : ""}<span className="dots" aria-hidden="true" /></p>}
          {view.status === "refunded" && <p className="msg">This send was refunded to the sender{view.providerRef ? `: ${view.providerRef}` : ""}.</p>}
          {view.status === "paid" && <p className="msg msg--ok">Delivered {view.fiat ?? `in ${view.currency}`}. Order {view.providerRef}.</p>}
          {(view.lockTx || view.depositTx || view.settleTx || view.receiptKey) && (
            <dl className="kv claim__proof">
              {view.lockTx && <><dt>locked</dt><dd><a className="inline" href={WC + view.lockTx} target="_blank" rel="noreferrer">{short(view.lockTx)}</a> on Whitechain</dd></>}
              {view.depositTx && <><dt>deposit</dt><dd><a className="inline" href={`https://sepolia.etherscan.io/tx/${view.depositTx}`} target="_blank" rel="noreferrer">{short(view.depositTx)}</a> to Transak</dd></>}
              {view.settleTx && <><dt>{view.status === "refunded" ? "refunded" : "released"}</dt><dd><a className="inline" href={WC + view.settleTx} target="_blank" rel="noreferrer">{short(view.settleTx)}</a> on Whitechain</dd></>}
              {view.receiptKey && <><dt>receipt</dt><dd><a className="inline" href={`/receipt/${view.receiptKey}`}>{short(view.receiptKey)}</a> on Arkiv</dd></>}
            </dl>
          )}
          {error && <p className="msg msg--err">{error}</p>}
        </section>
      )}
      <p className="claim__fine">The money waits in escrow on Whitechain until Transak pays you. Testnet: use Transak&apos;s staging test user and test card.</p>
    </div>
  );
}
