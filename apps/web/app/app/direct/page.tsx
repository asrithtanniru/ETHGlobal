"use client";

import { useState } from "react";
import type { Address, Hex } from "viem";
import { namehash } from "viem/ens";
import { useQuery } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { getVerifiedPayee } from "@ghar/ens";
import { PageHead, RequireWallet, TxStatus } from "@/components/app/AppShell";
import { useChatSession } from "@/components/app/chatSession";
import { useTx, type TxState } from "@/components/app/useTx";
import { ensClient, explain, parseUsdt, short, usdt, vault, when } from "@/lib/chain";
import { CURRENCIES, type Currency, type SendRow } from "@/lib/directShared";

type Ready = { biller: Address; payeeAvailable: string; agentAvailable: string; balance: string; agent: Address; directBiller: Address };
type Config = { configured: boolean; payee: string; ready?: Ready };
const MONTH = 30n * 86_400n;
const STATUS_TEXT: Record<SendRow["status"], string> = { unpaid: "not sent", pending: "waiting for claim", paid: "paid out", refunded: "refunded" };

export default function PayDirect() {
  return (
    <div className="page">
      <PageHead title="Pay with Direct">Send money from your vault to anyone. They claim it to their card or bank through Transak, or in INR to their UPI ID through P2P.me, and your vault releases the USDT only after they are paid.</PageHead>
      <RequireWallet>{(a) => <Direct address={a} />}</RequireWallet>
    </div>
  );
}

function Direct({ address }: { address: Address }) {
  const s = useChatSession(address);
  const cfg = useQuery({
    queryKey: ["direct-cfg", address, s.header],
    queryFn: async () => (await (await fetch("/api/direct", { headers: s.header ? { "x-ghar-session": s.header } : {} })).json()) as Config,
  });
  if (cfg.isLoading) return <p className="shimmer">Reading your vault</p>;
  if (!cfg.data?.configured) return <section className="card"><p className="msg msg--err">Pay with Direct isn&apos;t set up on this server yet (Transak, provider and direct biller keys).</p></section>;
  if (!s.header)
    return (
      <section className="card">
        <h2 className="card__h">Sign in to send</h2>
        <p className="card__p">Your wallet signs a free message so Kin knows the sends are yours.</p>
        <div className="form-actions"><button className="btn" onClick={() => s.ensure().catch(() => undefined)}>Sign in</button></div>
      </section>
    );
  const r = cfg.data.ready!;
  const inVault = r.biller.toLowerCase() === r.directBiller.toLowerCase();
  const granted = BigInt(r.agentAvailable) > 0n;
  return (
    <div className="work">
      <div className="stack">
        {(!inVault || !granted) && <Setup address={address} payee={cfg.data.payee} ready={r} inVault={inVault} granted={granted} onDone={() => cfg.refetch()} />}
        <SendForm address={address} ready={r} enabled={inVault && granted} header={s.header} ensure={s.ensure} onDone={() => cfg.refetch()} />
        <Sends header={s.header} clear={s.clear} />
      </div>
      <aside className="card work__rail">
        <h2 className="card__h">How it works</h2>
        <ol className="howto">
          <li>You enter an amount, a currency and your friend&apos;s email.</li>
          <li>Your vault locks the USDT for the payout provider. You sign once; Kin pays the gas.</li>
          <li>You share the claim link. Your friend opens it, signs in to Transak with that email and adds their card or bank.</li>
          <li>For INR, your friend just enters their UPI ID instead, and a P2P.me merchant pays it.</li>
          <li>Transak or the P2P.me merchant pays them. Only then does the vault release the USDT to the provider. A failed order refunds it to your vault, and an untouched one can be reclaimed after a day.</li>
        </ol>
        <p className="card__p">Testnet: Transak staging pays from the provider&apos;s Sepolia ETH float at its test price, so the fiat amount differs from the USDT.</p>
      </aside>
    </div>
  );
}

function Setup({ address, payee, ready, inVault, granted, onDone }: { address: Address; payee: string; ready: Ready; inVault: boolean; granted: boolean; onDone: () => void }) {
  const [per, setPer] = useState("50");
  const [cap, setCap] = useState("200");
  const addTx = useTx(onDone);
  const grantTx = useTx(onDone);
  const ens = useQuery({ queryKey: ["ens", payee], queryFn: () => getVerifiedPayee(ensClient as never, payee) });
  const pp = parseUsdt(per), pc = parseUsdt(cap);
  return (
    <section className="card">
      <h2 className="card__h">Set up once</h2>
      <p className="card__p">Direct is a payee like any other, so your caps limit every send.</p>
      <div className="fields2">
        <div className="field"><label htmlFor="d-per">Most per send (USDT)</label><input id="d-per" inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} /></div>
        <div className="field"><label htmlFor="d-cap">Most per 30 days (USDT)</label><input id="d-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></div>
      </div>
      <ul className="ready">
        <li className={inVault ? "ok" : ""}>
          {inVault ? <>{payee} is in your vault</> : <>
            <span>Add <span className="mono">{payee}</span>. Its biller <span className="mono">{short(ens.data?.biller)}</span> comes from ENS.</span>
            <button className="btn btn--sm" disabled={!pp || !pc || !ens.data || addTx.busy}
              onClick={() => addTx.run([{ ...vault, functionName: "setPayee", args: [namehash(payee), ens.data!.biller, pp!, pc!, MONTH], account: address }] as never, "Direct added")}>Add to vault</button>
            <TxStatus state={addTx.state} />
          </>}
        </li>
        <li className={granted ? "ok" : ""}>
          {granted ? <>The chat agent may send up to {usdt(BigInt(ready.agentAvailable))} USDT now</> : <>
            <span>Let the chat agent <span className="mono">{short(ready.agent)}</span> pay what you approve, within the same caps.</span>
            <button className="btn btn--sm" disabled={!pp || !pc || grantTx.busy}
              onClick={() => grantTx.run([{ ...vault, functionName: "setGrant", args: [ready.agent, pp!, pc!, MONTH], account: address }] as never, "Grant set")}>Set grant</button>
            <TxStatus state={grantTx.state} />
          </>}
        </li>
      </ul>
    </section>
  );
}

function SendForm({ address, ready, enabled, header, ensure, onDone }: { address: Address; ready: Ready; enabled: boolean; header: string; ensure: () => Promise<string>; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<TxState>({ phase: "idle" });
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const { mutateAsync: sign } = useSignMessage();
  const most = [ready.payeeAvailable, ready.agentAvailable, ready.balance].map(BigInt).reduce((a, b) => (b < a ? b : a));
  const busy = state.phase === "wallet" || state.phase === "pending";
  const post = async <T,>(body: object): Promise<T> => {
    const r = await fetch("/api/direct", { method: "POST", headers: { "content-type": "application/json", "x-ghar-session": await ensure() || header }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new Error(j.error ?? "That didn't work.");
    return j;
  };
  async function send() {
    setLink("");
    try {
      setState({ phase: "pending", msg: "Raising the send on Arkiv" });
      const { digest, message } = await post<{ digest: Hex; message: string }>({ action: "create", amount, currency, email });
      setState({ phase: "wallet", msg: "Approve the send in your wallet. It costs no gas" });
      const signature = await sign({ message });
      setState({ phase: "pending", msg: "Locking it in your vault" });
      const out = await post<{ hash: Hex; link: string }>({ action: "pay", digest, signature });
      setState({ phase: "done", msg: `${amount} USDT locked for your friend`, hash: out.hash });
      setLink(out.link);
      setAmount(""); setEmail("");
      onDone();
    } catch (e) {
      setState({ phase: "error", msg: explain(e) });
    }
  }
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (enabled && !busy) send(); }}>
      <h2 className="card__h">Send money</h2>
      <div className="fields2">
        <div className="field">
          <label htmlFor="d-amt">Amount (USDT)</label>
          <input id="d-amt" inputMode="decimal" placeholder="25.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="hint">Up to {usdt(most)} USDT now, from your vault</span>
        </div>
        <div className="field">
          <label htmlFor="d-cur">They receive</label>
          <select id="d-cur" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="d-mail">Friend&apos;s email</label>
        <input id="d-mail" type="email" placeholder="friend@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <span className="hint">{currency === "INR" ? "They claim it to their UPI ID through P2P.me with the link you share." : "Only someone signed in to Transak with this email can claim it."}</span>
      </div>
      <div className="form-actions"><button className="btn" disabled={!enabled || busy || !amount || !email}>{busy ? "Sending" : "Create claim link"}</button></div>
      <TxStatus state={state} />
      {link && (
        <div className="direct-link">
          <p className="mono">{link}</p>
          <div className="form-actions">
            <button type="button" className="btn btn--ghost" onClick={() => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined)}>{copied ? "Copied" : "Copy link"}</button>
            <a className="link" href={link} target="_blank" rel="noreferrer">Open claim page <span aria-hidden="true">→</span></a>
          </div>
        </div>
      )}
    </form>
  );
}

function Sends({ header, clear }: { header: string; clear: () => void }) {
  const list = useQuery({
    queryKey: ["direct-sends", header],
    refetchInterval: 15_000,
    queryFn: async () => {
      const r = await fetch("/api/direct/sends", { headers: { "x-ghar-session": header } });
      if (r.status === 401) clear();
      const j = (await r.json()) as { sends?: SendRow[]; error?: string };
      if (!r.ok) throw new Error(j.error);
      return j.sends ?? [];
    },
  });
  return (
    <section className="card card--list">
      <h2 className="card__h">Your sends</h2>
      {list.isLoading && <p className="empty">Reading your sends<span className="dots" /></p>}
      {list.error && <p className="empty msg--err">{(list.error as Error).message}</p>}
      {list.data?.length === 0 && <p className="empty">Nothing sent yet.</p>}
      {list.data?.map((s) => (
        <div className="list-row" key={s.digest}>
          <div>
            <div className="title">{s.amountUsdt} USDT → {s.currency}</div>
            <div className="mono" style={{ marginTop: "0.4rem" }}>{s.email} · {when(Math.floor(s.at / 1000))}</div>
          </div>
          <div className="body-l"><span className={`tag-pill${s.status === "pending" ? "" : " tag-pill--on"}`}>{STATUS_TEXT[s.status]}</span></div>
          {s.link ? <a className="link" href={s.link} target="_blank" rel="noreferrer">{s.status === "pending" ? "Claim link" : "Receipt"} <span aria-hidden="true">→</span></a> : <span />}
        </div>
      ))}
    </section>
  );
}
