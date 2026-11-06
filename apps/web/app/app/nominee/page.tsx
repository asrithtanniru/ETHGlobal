"use client";

import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useConnection, useReadContracts } from "wagmi";
import { PageHead, RequireWallet, TxStatus } from "@/components/app/AppShell";
import { useTx } from "@/components/app/useTx";
import { parseUsdt, short, usdt, vault, when } from "@/lib/chain";

const ZERO = "0x0000000000000000000000000000000000000000";

export default function Nominee() {
  return (
    <div className="page">
      <PageHead title="Nominee">Name a nominee and a delay. If you don&apos;t act on the vault for that long, the nominee can move your balance. Any action of yours locks them out again.</PageHead>
      <RequireWallet>{(a) => <div className="stack"><MyNominee address={a} /><ActAsNominee address={a} /></div>}</RequireWallet>
    </div>
  );
}

function MyNominee({ address }: { address: Address }) {
  const { data, refetch } = useReadContracts({ contracts: [{ ...vault, functionName: "nomineeOf", args: [address] }, { ...vault, functionName: "lastActive", args: [address] }] });
  const nom = data?.[0]?.result as readonly [Address, bigint] | undefined;
  const last = data?.[1]?.result as bigint | undefined;
  const has = nom && nom[0] !== ZERO;
  const [who, setWho] = useState("");
  const [days, setDays] = useState("90");
  const set = useTx(() => refetch());
  const remove = useTx(() => refetch());
  const d = Number(days);
  const ok = isAddress(who.trim()) && who.trim().toLowerCase() !== address.toLowerCase() && Number.isInteger(d) && d > 0;
  return (
    <div className="duo">
        <section className="card">
          <h2 className="card__h">Your nominee</h2>
          {has ? (
            <dl className="kv">
              <dt>nominee</dt><dd>{nom[0]}</dd>
              <dt>delay</dt><dd>{Number(nom[1]) / 86400} days</dd>
              <dt>last active</dt><dd>{last ? when(last) : "—"}</dd>
              <dt>unlocks</dt><dd>{last ? when(last + nom[1]) : "—"} unless you act before then</dd>
            </dl>
          ) : <p className="card__p">No nominee set. Your balance stays yours alone.</p>}
          {has && (
            <div className="form-actions">
              <button className="btn btn--ghost" disabled={remove.busy} onClick={() => remove.run([{ ...vault, functionName: "removeNominee", account: address }] as never, "Nominee removed")}>Remove nominee</button>
            </div>
          )}
          <TxStatus state={remove.state} />
        </section>
        <form className="card" onSubmit={(e) => { e.preventDefault(); if (ok) set.run([{ ...vault, functionName: "setNominee", args: [who.trim() as Address, BigInt(d * 86400)], account: address }] as never, "Nominee saved"); }}>
          <h2 className="card__h">{has ? "Replace nominee" : "Name a nominee"}</h2>
          <div className="field"><label htmlFor="nw">Nominee wallet</label><input id="nw" className="mono" placeholder="0x…" value={who} onChange={(e) => setWho(e.target.value)} /></div>
          <div className="field"><label htmlFor="nd">Delay (days without activity)</label><input id="nd" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></div>
          <div className="form-actions"><button className="btn" disabled={!ok || set.busy}>Save nominee</button></div>
          <TxStatus state={set.state} />
        </form>
    </div>
  );
}

function ActAsNominee({ address }: { address: Address }) {
  const [sender, setSender] = useState("");
  const [amt, setAmt] = useState("");
  const [to, setTo] = useState("");
  const valid = isAddress(sender.trim());
  const s = (valid ? sender.trim() : ZERO) as Address;
  const { data, refetch } = useReadContracts({
    contracts: [{ ...vault, functionName: "nomineeOf", args: [s] }, { ...vault, functionName: "lastActive", args: [s] }, { ...vault, functionName: "spendableOf", args: [s] }],
    query: { enabled: valid },
  });
  const nom = data?.[0]?.result as readonly [Address, bigint] | undefined;
  const last = data?.[1]?.result as bigint | undefined;
  const bal = data?.[2]?.result as bigint | undefined;
  const mine = nom && nom[0].toLowerCase() === address.toLowerCase();
  const unlocksAt = nom && last !== undefined ? last + nom[1] : undefined;
  const open = unlocksAt !== undefined && Date.now() / 1000 >= Number(unlocksAt);
  const tx = useTx(() => { setAmt(""); refetch(); });
  const v = parseUsdt(amt);
  const dest = (to.trim() || address) as Address;
  const { address: me } = useConnection();
  return (
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (mine && open && v && isAddress(dest)) tx.run([{ ...vault, functionName: "nomineeWithdraw", args: [s, v, dest], account: me }] as never, `Moved ${amt} USDT`); }}>
        <h2 className="card__h">Acting as a nominee</h2>
        <p className="card__p">If someone named this wallet as their nominee, enter their address to check the timer.</p>
        <div className="fields2">
          <div className="field"><label htmlFor="ns">Sender wallet</label><input id="ns" className="mono" placeholder="0x…" value={sender} onChange={(e) => setSender(e.target.value)} /></div>
          <div>
            {valid && nom && (
              <dl className="kv">
                <dt>balance</dt><dd>{usdt(bal)} USDT</dd>
                <dt>nominee</dt><dd>{nom[0] === ZERO ? "none" : mine ? "this wallet" : short(nom[0])}</dd>
                {unlocksAt !== undefined && nom[0] !== ZERO && <><dt>unlocks</dt><dd>{when(unlocksAt)}{open ? " · open now" : ""}</dd></>}
              </dl>
            )}
          </div>
        </div>
        {mine && open && (
          <div className="fields2">
            <div className="field"><label htmlFor="na">Amount (USDT)</label><input id="na" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
            <div className="field"><label htmlFor="nt">Send to</label><input id="nt" className="mono" placeholder={address} value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        )}
        <div className="form-actions">
          <button className="btn" disabled={!mine || !open || !v || tx.busy}>Withdraw as nominee</button>
          {valid && nom && !mine && nom[0] !== ZERO && <span className="hint">This wallet isn&apos;t their nominee.</span>}
          {valid && mine && !open && <span className="hint">Locked until the timer runs out.</span>}
        </div>
        <TxStatus state={tx.state} />
      </form>
  );
}
