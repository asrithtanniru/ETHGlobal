"use client";

import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useQuery } from "@tanstack/react-query";
import { Coin } from "@/components/ui";
import { PageHead, RequireWallet, TxStatus } from "@/components/app/AppShell";
import { useTx } from "@/components/app/useTx";
import { chainClient, explain, parseUsdt, period, short, usdt, vault, vaultEvents } from "@/lib/chain";

export default function Agent() {
  return (
    <div className="page">
      <PageHead title="Agent">A grant lets one agent wallet pay bills from your balance, up to a cap per bill and per period. Revoking it takes effect in the same block.</PageHead>
      <RequireWallet>{(a) => <Grants address={a} />}</RequireWallet>
    </div>
  );
}

type Grant = { agent: Address; perPayment: bigint; perPeriod: bigint; period: bigint; available: bigint };

function Grants({ address }: { address: Address }) {
  const list = useQuery({
    queryKey: ["grants", address],
    queryFn: async (): Promise<Grant[]> => {
      const evs = await vaultEvents("GrantSet", { sender: address });
      const agents = [...new Set(evs.map((e) => (e.args as { agent: Address }).agent))];
      const rows = await Promise.all(agents.map(async (agent) => {
        const [lim, available] = await Promise.all([
          chainClient.readContract({ ...vault, functionName: "grantOf", args: [address, agent] }),
          chainClient.readContract({ ...vault, functionName: "availableToAgent", args: [address, agent] }),
        ]);
        const [perPayment, perPeriod, period] = lim as readonly [bigint, bigint, bigint, bigint, bigint];
        return { agent, perPayment, perPeriod, period, available: available as bigint };
      }));
      return rows.filter((r) => r.period > 0n); // revoked grants read back as period 0
    },
  });
  return (
    <div className="work">
      <SetGrant address={address} onDone={() => list.refetch()} />
      <section className="card card--list">
        <h2 className="card__h">Active grants</h2>
        {list.isLoading && <p className="empty">Reading grants from Whitechain<span className="dots" /></p>}
        {list.error && <p className="empty msg--err">{explain(list.error)}</p>}
        {list.data?.length === 0 && <p className="empty">No agent can spend from your vault yet.</p>}
        {list.data?.map((g) => <GrantRow key={g.agent} g={g} address={address} onDone={() => list.refetch()} />)}
      </section>
    </div>
  );
}

function GrantRow({ g, address, onDone }: { g: Grant; address: Address; onDone: () => void }) {
  const tx = useTx(onDone);
  return (
    <div className="list-row">
      <div className="mono" style={{ color: "var(--ink)" }} title={g.agent}>{short(g.agent)}</div>
      <div className="body-l">
        Up to {usdt(g.perPayment)} per bill, {usdt(g.perPeriod)} per {period(g.period)} · <span style={{ color: "var(--ink)" }}>{usdt(g.available)} <Coin c="USDT" />USDT</span> spendable now
        <TxStatus state={tx.state} />
      </div>
      <button className="btn btn--ghost" disabled={tx.busy} onClick={() => tx.run([{ ...vault, functionName: "revokeGrant", args: [g.agent], account: address }] as never, "Grant revoked")}>Revoke</button>
    </div>
  );
}

function SetGrant({ address, onDone }: { address: Address; onDone: () => void }) {
  const [agent, setAgent] = useState("");
  const [per, setPer] = useState("");
  const [cap, setCap] = useState("");
  const [days, setDays] = useState("30");
  const tx = useTx(onDone);
  const pp = parseUsdt(per), pc = parseUsdt(cap), d = Number(days);
  const ok = isAddress(agent.trim()) && pp && pc && Number.isInteger(d) && d > 0;
  return (
    <form className="card work__rail" onSubmit={(e) => {
      e.preventDefault();
      if (ok) tx.run([{ ...vault, functionName: "setGrant", args: [agent.trim() as Address, pp, pc, BigInt(d * 86400)], account: address }] as never, "Grant saved");
    }}>
      <h2 className="card__h">Set a grant</h2>
      <div className="field"><label htmlFor="ag">Agent wallet</label><input id="ag" className="mono" placeholder="0x…" value={agent} onChange={(e) => setAgent(e.target.value)} /><span className="hint">Setting a grant again replaces its caps.</span></div>
      <div className="fields2">
        <div className="field"><label htmlFor="gper">Cap per bill (USDT)</label><input id="gper" inputMode="decimal" placeholder="150" value={per} onChange={(e) => setPer(e.target.value)} /></div>
        <div className="field"><label htmlFor="gcap">Cap per period (USDT)</label><input id="gcap" inputMode="decimal" placeholder="500" value={cap} onChange={(e) => setCap(e.target.value)} /></div>
      </div>
      {pp !== undefined && pc !== undefined && pp > pc && <p className="hint hint--block">The per-period cap limits each bill too, so bills above {cap} USDT can&apos;t be paid.</p>}
      <div className="field"><label htmlFor="gdays">Period (days)</label><input id="gdays" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></div>
      <div className="form-actions"><button className="btn" disabled={!ok || tx.busy}>Save grant</button></div>
      <TxStatus state={tx.state} />
    </form>
  );
}
