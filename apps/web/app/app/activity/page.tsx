"use client";

import { useState } from "react";
import { namehash, normalize } from "viem/ens";
import type { Address, Hex } from "viem";
import { useConnection } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { PAYEE_BOOK_PARENT } from "@ghar/shared";
import { PageHead, TxStatus } from "@/components/app/AppShell";
import { useTx } from "@/components/app/useTx";
import { chainClient, explain, explorerTx, short, usdt, vault, vaultEvents, when } from "@/lib/chain";
import { nameFor } from "@/lib/names";

const SETTLE_WINDOW = 86_400; // GharVault.SETTLE_WINDOW
const STATUS = ["none", "pending", "paid", "refunded"] as const;

type Payout = {
  digest: Hex; payee: Hex; sender: Address; amount: bigint; agent: Address; tx: Hex; requestedAt: bigint;
  status: (typeof STATUS)[number]; note?: string; settleTx?: Hex;
};

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

function Payouts({ filter, title, me }: { filter: { sender?: Address; payee?: Hex }; title: string; me?: Address }) {
  const q = useQuery({
    queryKey: ["payouts", filter],
    queryFn: async (): Promise<Payout[]> => {
      const req = await vaultEvents("PayoutRequested", filter);
      if (!req.length) return [];
      const [done, refunded, reclaimed] = await Promise.all([vaultEvents("PayoutCompleted"), vaultEvents("PayoutRefunded"), vaultEvents("PayoutReclaimed")]);
      const settle = new Map<Hex, { note?: string; tx: Hex }>();
      for (const e of done) settle.set((e.args as { digest: Hex }).digest, { note: `provider ref ${(e.args as { providerRef: string }).providerRef}`, tx: e.transactionHash });
      for (const e of refunded) settle.set((e.args as { digest: Hex }).digest, { note: `refunded: ${(e.args as { reason: string }).reason}`, tx: e.transactionHash });
      for (const e of reclaimed) settle.set((e.args as { digest: Hex }).digest, { note: "reclaimed after the settle window", tx: e.transactionHash });
      const rows = await Promise.all(req.map(async (e) => {
        const a = e.args as { sender: Address; payee: Hex; digest: Hex; amount: bigint; agent: Address };
        const p = (await chainClient.readContract({ ...vault, functionName: "payoutOf", args: [a.digest] })) as readonly [Address, bigint, number, bigint];
        const s = settle.get(a.digest);
        return { digest: a.digest, payee: a.payee, sender: a.sender, amount: a.amount, agent: a.agent, tx: e.transactionHash, requestedAt: p[1], status: STATUS[p[2]] ?? "none", note: s?.note, settleTx: s?.tx };
      }));
      return rows.reverse();
    },
  });
  return (
    <section className="card card--list">
      <h2 className="card__h">{title}</h2>
        {q.isLoading && <p className="empty">Reading payouts from Whitechain<span className="dots" /></p>}
        {q.error && <p className="empty msg--err">{explain(q.error)}</p>}
        {q.data?.length === 0 && <p className="empty">No payouts yet. The agent requests one when it pays a verified, signed bill.</p>}
        {q.data?.map((p) => <PayoutRow key={p.digest} p={p} me={me} onDone={() => q.refetch()} />)}
    </section>
  );
}

function PayoutRow({ p, me, onDone }: { p: Payout; me?: Address; onDone: () => void }) {
  const tx = useTx(onDone);
  const receipt = useQuery({
    queryKey: ["receipt", p.digest],
    queryFn: async (): Promise<{ key: string } | null> => (await (await fetch(`/api/receipts?digest=${p.digest}`)).json()).receipt ?? null,
    enabled: p.status !== "pending",
  });
  const closesAt = Number(p.requestedAt) + SETTLE_WINDOW;
  const canReclaim = p.status === "pending" && Date.now() / 1000 >= closesAt;
  return (
    <div className="list-row">
      <div>
        <div className="title">{usdt(p.amount)} USDT</div>
        <div className="mono" style={{ marginTop: "0.6rem" }}>{nameFor(p.payee) ?? short(p.payee)}</div>
      </div>
      <div className="body-l">
        <span className={`tag-pill ${p.status === "paid" ? "tag-pill--on" : ""}`}>{p.status}</span>{" "}
        requested {when(p.requestedAt)} by agent <span className="mono">{short(p.agent)}</span>
        {p.note && <> · {p.note}</>}
        {p.status === "pending" && !canReclaim && <> · provider has until {when(closesAt)}</>}
        <div className="mono" style={{ marginTop: "0.6rem" }}>
          <a href={explorerTx(p.tx)} target="_blank" rel="noreferrer">request {short(p.tx)}</a>
          {p.settleTx && <> · <a href={explorerTx(p.settleTx)} target="_blank" rel="noreferrer">settled {short(p.settleTx)}</a></>}
          {receipt.data?.key && <> · <a href={`/receipt/${receipt.data.key}`}>receipt</a></>}
        </div>
        <TxStatus state={tx.state} />
      </div>
      {canReclaim && me ? (
        <button className="btn btn--ghost" disabled={tx.busy} onClick={() => tx.run([{ ...vault, functionName: "reclaim", args: [p.digest], account: me }] as never, "USDT returned to the sender's balance")}>Reclaim</button>
      ) : <span />}
    </div>
  );
}
