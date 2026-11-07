"use client";

import { useState } from "react";
import { namehash, normalize } from "viem/ens";
import { useConnection } from "wagmi";
import { PAYEE_BOOK_PARENT } from "@ghar/shared";
import { PageHead } from "@/components/app/AppShell";
import { Payouts } from "@/components/app/Payouts";

export default function Activity() {
  const { address } = useConnection();
  const [payeeInput, setPayeeInput] = useState("");
  const [payee, setPayee] = useState<string | null>(null);
  const [err, setErr] = useState("");
  return (
    <div className="page">
      <PageHead title="Activity">Read straight from the vault&apos;s events on Whitechain Sepolia. Senders see their payouts; anyone can look up the payouts made to a payee name.</PageHead>
      <div className="stack">
        <form className="card lookup" onSubmit={(e) => {
          e.preventDefault();
          try { setPayee(normalize(payeeInput.trim())); setErr(""); } catch { setErr("That isn't a valid name."); }
        }}>
          <div className="field">
            <label htmlFor="pn">Payee name</label>
            <input id="pn" placeholder={`rent.${PAYEE_BOOK_PARENT}`} value={payeeInput} onChange={(e) => setPayeeInput(e.target.value)} />
          </div>
          <button className="btn btn--ghost" disabled={!payeeInput.trim()}>Show payouts to this payee</button>
          {payee && <button type="button" className="link" onClick={() => { setPayee(null); setPayeeInput(""); }}>Back to my payouts</button>}
          {err && <p className="msg msg--err">{err}</p>}
        </form>
        {payee ? <Payouts filter={{ payee: namehash(payee) }} title={payee} />
          : address ? <Payouts filter={{ sender: address }} title="Your payouts" me={address} />
          : <section className="card card--list"><p className="empty">Connect a wallet to see your own payouts, or look up a payee above.</p></section>}
      </div>
    </div>
  );
}
