"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { namehash } from "viem/ens";
import type { Address, Hex } from "viem";
import { useQuery } from "@tanstack/react-query";
import { PAYEE_BOOK_PARENT, type VerifiedPayee } from "@ghar/shared";
import { buildPayeeName, getVerifiedPayee } from "@ghar/ens";
import { PageHead, RequireWallet, TxStatus } from "@/components/app/AppShell";
import { useTx } from "@/components/app/useTx";
import { activePayees, chainClient, ensClient, explain, parseUsdt, period, short, usdt, vault } from "@/lib/chain";
import { nameFor, rememberName } from "@/lib/names";

export default function Payees() {
  return (
    <div className="page">
      <PageHead title="Payees">Each payee is a name under the family&apos;s ENS name. Kin reads its payout account and biller wallet from ENS, so neither can be typed in or swapped.</PageHead>
      <RequireWallet>{(a) => <div className="work"><Suspense><AddPayee address={a} /></Suspense><Book address={a} /></div>}</RequireWallet>
    </div>
  );
}

type Row = { node: Hex; biller: Address; perPayment: bigint; perPeriod: bigint; period: bigint; available: bigint };

function Book({ address }: { address: Address }) {
  const list = useQuery({
    queryKey: ["payees", address],
    queryFn: async (): Promise<Row[]> => {
      const nodes = await activePayees(address);
      return Promise.all(nodes.map(async (node) => {
        const [biller, lim, available] = await Promise.all([
          chainClient.readContract({ ...vault, functionName: "billerOf", args: [address, node] }),
          chainClient.readContract({ ...vault, functionName: "payeeOf", args: [address, node] }),
          chainClient.readContract({ ...vault, functionName: "availableToPayee", args: [address, node] }),
        ]);
        const [perPayment, perPeriod, period] = lim as readonly [bigint, bigint, bigint, bigint, bigint];
        return { node, biller: biller as Address, perPayment, perPeriod, period, available: available as bigint };
      }));
    },
  });
  useEffect(() => {
    const again = () => list.refetch();
    window.addEventListener("ghar:payees", again);
    return () => window.removeEventListener("ghar:payees", again);
  }, [list.refetch]);
  return (
    <section className="card card--list">
      <h2 className="card__h">In your vault</h2>
      {list.isLoading && <p className="empty">Reading payees from Whitechain<span className="dots" /></p>}
      {list.error && <p className="empty msg--err">{explain(list.error)}</p>}
      {list.data?.length === 0 && <p className="empty">No payees yet. Look up a bill type to add your first.</p>}
      {list.data?.map((r) => <PayeeRow key={r.node} r={r} address={address} onDone={() => list.refetch()} />)}
    </section>
  );
}

function PayeeRow({ r, address, onDone }: { r: Row; address: Address; onDone: () => void }) {
  const tx = useTx(onDone);
  return (
    <div className="list-row">
      <div>
        <div className="title">{nameFor(r.node) ?? <span className="mono">{short(r.node)}</span>}</div>
        <div className="mono" style={{ marginTop: "0.6rem" }}>biller {short(r.biller)}</div>
      </div>
      <div className="body-l">
        Up to {usdt(r.perPayment)} per bill, {usdt(r.perPeriod)} per {period(r.period)} · <span style={{ color: "var(--ink)" }}>{usdt(r.available)} USDT</span> payable now
        <TxStatus state={tx.state} />
      </div>
      <button className="btn btn--ghost" disabled={tx.busy} onClick={() => tx.run([{ ...vault, functionName: "removePayee", args: [r.node], account: address }] as never, "Payee removed")}>Remove</button>
    </div>
  );
}

function AddPayee({ address }: { address: Address }) {
  const params = useSearchParams();
  const [family, setFamily] = useState(params.get("family") ?? PAYEE_BOOK_PARENT);
  const [tag, setTag] = useState(params.get("tag") ?? "");
  const [found, setFound] = useState<VerifiedPayee | null>(null);
  const [lookErr, setLookErr] = useState("");
  const [looking, setLooking] = useState(false);
  const [per, setPer] = useState("");
  const [cap, setCap] = useState("");
  const [days, setDays] = useState("30");
  const tx = useTx(() => { window.dispatchEvent(new Event("ghar:payees")); setFound(null); });
  useEffect(() => { setFound(null); setLookErr(""); }, [tag, family]);

  async function lookUp() {
    setLooking(true); setLookErr("");
    try {
      const p = await getVerifiedPayee(ensClient as never, buildPayeeName(family, tag));
      setFound(p); rememberName(namehash(p.name), p.name);
    } catch (e) {
      setLookErr(/missing payee records/.test(String(e)) ? "No verified records on that name yet. The provider writes them after verifying the account." : explain(e));
    } finally { setLooking(false); }
  }
  const pp = parseUsdt(per), pc = parseUsdt(cap), d = Number(days);
  const ok = found && pp && pc && Number.isInteger(d) && d > 0;
  const perOverCap = pp !== undefined && pc !== undefined && pp > pc;
  return (
    <div className="card work__rail">
      <form onSubmit={(e) => { e.preventDefault(); if (tag.trim()) lookUp(); }}>
        <h2 className="card__h">Add a payee</h2>
        <div className="field">
          <label htmlFor="family">Family name</label>
          <input id="family" value={family} onChange={(e) => setFamily(e.target.value.trim())} />
        </div>
        <div className="field">
          <label htmlFor="tag">Bill type</label>
          <div className="lookup lookup--tight">
            <input id="tag" placeholder="rent" value={tag} onChange={(e) => setTag(e.target.value)} />
            <button className="btn" disabled={!tag.trim() || !family || looking}>{looking ? "Reading ENS" : "Look up"}</button>
          </div>
          <span className="hint">{tag.trim() ? (() => { try { return buildPayeeName(family, tag); } catch (e) { return String((e as Error).message); } })() : `Becomes tag.${family}`}</span>
        </div>
        <p className={lookErr ? "msg msg--err" : "msg"}>{lookErr}</p>
      </form>
      {found ? (
        <form className="card__more" onSubmit={(e) => {
          e.preventDefault();
          if (ok) tx.run([{ ...vault, functionName: "setPayee", args: [namehash(found.name), found.biller, pp, pc, BigInt(d * 86400)], account: address }] as never, `${found.name} added`);
        }}>
          <h3 className="card__h">{found.name}</h3>
          <dl className="kv">
            <dt>payout</dt><dd>{found.payoutRef}</dd>
            <dt>biller</dt><dd>{found.biller}</dd>
          </dl>
          <div className="fields2">
            <div className="field"><label htmlFor="per">Cap per bill (USDT)</label><input id="per" inputMode="decimal" placeholder="150" value={per} onChange={(e) => setPer(e.target.value)} /></div>
            <div className="field"><label htmlFor="cap">Cap per period (USDT)</label><input id="cap" inputMode="decimal" placeholder="300" value={cap} onChange={(e) => setCap(e.target.value)} /></div>
          </div>
          {perOverCap && <p className="hint hint--block">The per-period cap limits each bill too, so bills above {cap} USDT can&apos;t be paid.</p>}
          <div className="field"><label htmlFor="days">Period (days)</label><input id="days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></div>
          <div className="form-actions"><button className="btn" disabled={!ok || tx.busy}>Add to vault</button></div>
        </form>
      ) : <p className="card__p">Look up a bill type to read its payout account and biller from ENS on Sepolia.</p>}
      <TxStatus state={tx.state} />
    </div>
  );
}
