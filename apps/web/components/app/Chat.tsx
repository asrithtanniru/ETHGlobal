"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { erc20Abi, type Address, type Hex } from "viem";
import { namehash } from "viem/ens";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReadContract, useSignMessage } from "wagmi";
import { Icon } from "../ui";
import { TxStatus } from "./AppShell";
import { useTx, type TxState } from "./useTx";
import { depositWithoutGas, gaslessMin, useGasless } from "./gasless";
import { chatApi, useChatSession, type ThreadRow } from "./chatSession";
import { GHAR_VAULT, USDT, settlementChain } from "@ghar/shared";
import { explain, short, usdt, vault } from "@/lib/chain";
import { MAX_MESSAGE, payMessage, type ActionCard, type BillCard, type ChatEvent, type Step, type StoredTurn } from "@/lib/chatSign";
import { knownNames, rememberName } from "@/lib/names";
import { reason } from "@/lib/reasons";
import { blocksOf, LIST_ITEM } from "@/lib/rich";

type Turn = {
  local: string;
  user: string;
  assistant: string;
  steps: Step[];
  bills: BillCard[];
  actions: ActionCard[];
  /** Started in this page view. Setup cards from stored turns get no button, so a deposit can't be repeated by accident. */
  live?: boolean;
  status: "streaming" | "done" | "error" | "stopped";
  error?: string;
  saved?: "saving" | "saved" | "failed";
  saveNote?: string;
  key?: Hex;
};

// A first message typed on the home screen, handed to the new thread's page on navigation.
const pending = new Map<string, string>();

const SUGGESTIONS = ["Pay my school fees", "Which bills are due this week?", "How much is in my vault?", "Why can't a bill be paid?"];

export function ChatView({ address, id }: { address: Address; id?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const s = useChatSession(address);
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const abort = useRef<AbortController | null>(null);
  const first = useRef(id ? pending.get(id) : undefined);
  const started = useRef(false);
  // Follow the answer while it streams, unless the reader scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const saved = useQuery({
    queryKey: ["chat", address, id],
    enabled: !!id && !first.current && !!s.header,
    staleTime: Infinity,
    queryFn: () => chatApi<{ turns: (StoredTurn & { key: Hex })[] }>(`/api/chat?thread=${id}`, s.header!, s.clear).then((r) => r.turns),
  });
  useEffect(() => {
    if (saved.data) setTurns(saved.data.map((t) => ({ ...t, actions: t.actions ?? [], local: t.key, steps: t.steps.map((label, i) => ({ id: String(i), label, done: true })), status: "done", saved: "saved" })));
  }, [saved.data]);

  const patch = (local: string, fn: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.local === local ? fn(t) : t)));

  function apply(local: string, seq: number, e: ChatEvent) {
    if (e.t === "end") setBusy(false);
    if (e.t === "saved" && seq === 0) qc.invalidateQueries({ queryKey: ["chats", address] });
    patch(local, (t) => {
      switch (e.t) {
        case "step": return { ...t, steps: [...t.steps, { id: e.id, label: e.label, done: false }] };
        case "step-done": return { ...t, steps: t.steps.map((x) => (x.id === e.id ? { ...x, done: true } : x)) };
        case "text": return { ...t, assistant: t.assistant + e.d };
        case "bills": return { ...t, bills: e.bills };
        case "actions": return { ...t, actions: e.actions };
        case "error": return { ...t, status: "error", error: e.message };
        case "end": return { ...t, status: t.status === "streaming" ? "done" : t.status, saved: t.assistant.trim() ? "saving" : undefined };
        case "saved": return { ...t, saved: "saved", key: e.key };
        case "save-failed": return { ...t, saved: "failed", saveNote: e.reason };
        default: return t; // an event this page doesn't know yet, from a newer server
      }
    });
  }

  /** Returns false when nothing was sent, so the composer can keep the text. */
  async function send(raw: string): Promise<boolean> {
    const text = raw.trim();
    if (!text || busy) return false;
    setNotice("");
    let header: string;
    try { header = await s.ensure(); } catch (e) { setNotice(explain(e)); return false; }
    if (!id) {
      const thread = crypto.randomUUID();
      pending.set(thread, text);
      qc.setQueryData<ThreadRow[]>(["chats", address], (old) => [{ thread, title: text.slice(0, 80), at: Date.now() }, ...(old ?? [])]);
      router.push(`/app/chat/${thread}`);
      return true;
    }
    const local = crypto.randomUUID();
    const seq = turnsRef.current.length;
    const history = turnsRef.current.filter((t) => t.assistant.trim()).slice(-12).map((t) => ({ user: t.user, assistant: t.assistant }));
    setTurns((all) => [...all, { local, user: text, assistant: "", steps: [], bills: [], actions: [], live: true, status: "streaming" }]);
    setBusy(true);
    stick.current = true;
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ghar-session": header },
        body: JSON.stringify({ thread: id, seq, text, history, names: knownNames() }),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) {
        if (r.status === 401) s.clear();
        throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "The assistant couldn't answer just now.");
      }
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) apply(local, seq, JSON.parse(line) as ChatEvent);
      }
    } catch (e) {
      if (ctrl.signal.aborted) patch(local, (t) => ({ ...t, status: "stopped" }));
      else patch(local, (t) => ({ ...t, status: "error", error: e instanceof Error ? e.message : "Something went wrong." }));
    } finally {
      setBusy(false);
    }
    return true;
  }

  useEffect(() => {
    if (!id || !first.current || started.current) return;
    started.current = true;
    pending.delete(id);
    send(first.current);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setAtBottom(near);
  };
  useEffect(() => {
    if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns]);

  const composer = <Composer busy={busy} onSend={send} onStop={() => abort.current?.abort()} />;
  const fine = <p className="chat__fine">Kin only pays bills a verified biller signed, and each payment needs your wallet&apos;s approval.</p>;

  if (!id)
    return (
      <div className="chat chat--home">
        <div className="chat__hello">
          <h1>What should Kin take care of?</h1>
          <p>Ask about bills, payees or your balance. Kin checks every bill on Arkiv and ENS before you approve it.</p>
        </div>
        <div className="chat__dock">
          {notice && <p className="msg msg--err chat__notice">{notice}</p>}
          {composer}
          <div className="chips">
            {SUGGESTIONS.map((q) => <button key={q} className="chip" onClick={() => send(q)}>{q}</button>)}
          </div>
        </div>
      </div>
    );

  return (
    <div className="chat">
      <div className="chat__scroll" ref={scroller} onScroll={onScroll}>
        <div className="chat__col" aria-live="polite">
          {!s.header && !first.current && (
            <div className="chat__gate">
              <p>Sign in with your wallet to open this conversation. It costs nothing.</p>
              <button className="btn" onClick={() => s.ensure().catch((e) => setNotice(explain(e)))}>Sign in</button>
            </div>
          )}
          {saved.isLoading && <p className="shimmer">Reading this conversation from Arkiv</p>}
          {saved.error && <p className="msg msg--err">{(saved.error as Error).message}</p>}
          {saved.data?.length === 0 && turns.length === 0 && <p className="chat__empty">Nothing here yet. A new conversation can take a few seconds to reach Arkiv.</p>}
          {turns.map((t) => <TurnView key={t.local} t={t} address={address} ensure={s.ensure} />)}
        </div>
      </div>
      <div className="chat__dock">
        {!atBottom && (
          <button className="chat__down" aria-label="Scroll to the latest message" onClick={() => { stick.current = true; scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }}>
            <Icon.down />
          </button>
        )}
        {notice && <p className="msg msg--err chat__notice">{notice}</p>}
        {composer}
        {fine}
      </div>
    </div>
  );
}

function Composer({ busy, onSend, onStop }: { busy: boolean; onSend: (t: string) => Promise<boolean>; onStop: () => void }) {
  const [v, setV] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, [v]);
  const submit = () => {
    const text = v;
    if (!text.trim() || busy) return;
    setV("");
    onSend(text).then((ok) => { if (!ok) setV(text); });
  };
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label className="sr-only" htmlFor="ask">Message Kin</label>
      <textarea
        id="ask" ref={ref} rows={1} value={v} maxLength={MAX_MESSAGE} placeholder="Ask Kin to pay a bill"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
      />
      {busy
        ? <button type="button" className="composer__btn" onClick={onStop} aria-label="Stop answering"><Icon.stop /></button>
        : <button className="composer__btn" disabled={!v.trim()} aria-label="Send message"><Icon.send /></button>}
    </form>
  );
}

function TurnView({ t, address, ensure }: { t: Turn; address: Address; ensure: () => Promise<string> }) {
  const working = t.status === "streaming";
  const running = t.steps.find((s) => !s.done);
  return (
    <article className="turn">
      <p className="turn__user">{t.user}</p>
      <div className="turn__ai">
        {t.steps.length > 0 && (working && running
          ? <p className="shimmer">{running.label}</p>
          : (
            <details className="steps">
              <summary>Checked {t.steps.length} source{t.steps.length === 1 ? "" : "s"}</summary>
              <ul>{t.steps.map((s) => <li key={s.id}>{s.label}</li>)}</ul>
            </details>
          ))}
        {working && !t.assistant && !running && <p className="shimmer">Thinking</p>}
        {t.assistant && <Rich text={t.assistant} caret={working} />}
        {t.bills.map((b) => <Bill key={b.digest} bill={b} address={address} ensure={ensure} />)}
        {t.actions.map((a, i) => <Action key={i} a={a} address={address} live={!!t.live} />)}
        {t.status === "error" && <p className="msg msg--err">{t.error}</p>}
        {!working && <Meta t={t} />}
      </div>
    </article>
  );
}

function Meta({ t }: { t: Turn }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="turn__meta">
      {t.assistant && (
        <button className="icon-btn" aria-label={copied ? "Copied" : "Copy answer"} title={copied ? "Copied" : "Copy"}
          onClick={() => navigator.clipboard.writeText(t.assistant).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined)}>
          {copied ? <Icon.check /> : <Icon.copy />}
        </button>
      )}
      {t.status === "stopped" && <span>Stopped</span>}
      {t.saved === "saving" && <span>Saving to Arkiv<span className="dots" aria-hidden="true" /></span>}
      {t.saved === "saved" && t.key && <span title={t.key}>Saved on Arkiv, encrypted · <span className="mono">{short(t.key)}</span></span>}
      {t.saved === "failed" && <span>Not saved: {t.saveNote}</span>}
    </div>
  );
}

const STATUS = ["", "Paid from your vault. The provider is paying it out now.", "Paid.", "Refunded to your vault."];

export function Bill({ bill, address, ensure }: { bill: BillCard; address: Address; ensure: () => Promise<string> }) {
  const { mutateAsync: sign } = useSignMessage();
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  const live = useReadContract({ ...vault, functionName: "payoutOf", args: [bill.digest], query: { refetchInterval: 15_000 } });
  const status = Number((live.data as readonly unknown[] | undefined)?.[2] ?? 0);
  const receipt = useQuery({
    queryKey: ["receipt", bill.digest],
    enabled: status >= 2,
    refetchInterval: (q) => (q.state.data ? false : 15_000),
    queryFn: async () => ((await (await fetch(`/api/receipts?digest=${bill.digest}`)).json()) as { receipt?: { key: Hex } | null }).receipt ?? null,
  });
  const amount = usdt(BigInt(bill.amount));
  const due = new Date(bill.dueDate * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  async function pay() {
    try {
      const header = await ensure();
      setTx({ phase: "wallet", msg: "Approve the payment in your wallet" });
      const signature = await sign({ message: payMessage(bill.digest, address) });
      setTx({ phase: "pending", msg: "Paying from your vault on Whitechain" });
      const r = await fetch("/api/chat/pay", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ghar-session": header },
        body: JSON.stringify({ payee: bill.payee, digest: bill.digest, signature }),
      });
      const j = (await r.json().catch(() => ({}))) as { hash?: Hex; error?: string };
      if (!r.ok || !j.hash) throw new Error(j.error ?? "The payment didn't go through.");
      setTx({ phase: "done", msg: `Paid ${amount} USDT`, hash: j.hash });
      live.refetch();
    } catch (e) {
      setTx({ phase: "error", msg: explain(e) });
    }
  }

  const busy = tx.phase === "wallet" || tx.phase === "pending";
  return (
    <section className="bill" aria-label={`Bill for ${amount} USDT`}>
      <div className="bill__top">
        <p className="bill__amt">{amount}<small>USDT</small></p>
        <span className={`tag-pill${status ? " tag-pill--on" : ""}`}>{status ? ["", "pending", "paid", "refunded"][status] : `due ${due}`}</span>
      </div>
      <p className="bill__meta mono">{bill.payee} · {bill.invoiceRef} · {bill.currency}</p>
      {bill.payable && !status && (
        <ul className="bill__checks">
          <li>Signed by the biller in this payee&apos;s ENS record</li>
          <li>Inside your caps and vault balance</li>
          <li>Not paid before</li>
          {bill.aiNote && <li className="warn">AI review: {bill.aiNote}</li>}
        </ul>
      )}
      {status > 0 ? (
        <p className="bill__state">
          {STATUS[status]}
          {receipt.data && <> <a className="link" href={`/receipt/${receipt.data.key}`}>Receipt <span aria-hidden="true">→</span></a></>}
        </p>
      ) : bill.payable ? (
        tx.phase !== "done" && <button className="btn" onClick={pay} disabled={busy}>{busy ? "Paying" : `Approve and pay ${amount} USDT`}</button>
      ) : (
        <p className="bill__state">Can&apos;t pay this one: {reason(bill.reason ?? "")}.</p>
      )}
      <TxStatus state={tx} />
    </section>
  );
}

const days = (sec: number) => `${sec / 86_400} day${sec === 86_400 ? "" : "s"}`;

/** A setup step for the sender's own wallet: the same vault calls the Vault, Payees and Agent pages make. */
function Action({ a, address, live }: { a: ActionCard; address: Address; live: boolean }) {
  const tx = useTx(() => {
    if (a.kind === "add-payee") { rememberName(namehash(a.name), a.name); window.dispatchEvent(new Event("ghar:payees")); }
  });
  const token = { address: USDT.address, abi: erc20Abi, chainId: settlementChain.id } as const;
  const allowance = useReadContract({ ...token, functionName: "allowance", args: [address, GHAR_VAULT], query: { enabled: live && a.kind === "deposit" } });
  const gasless = useGasless();
  const [relay, setRelay] = useState<TxState>({ phase: "idle" });
  let title: string, detail: ReactNode, cta: string, ok: string, steps: unknown[];
  let run = () => tx.run(steps as never, ok);
  if (a.kind === "deposit") {
    const v = BigInt(a.amount);
    const approve = (allowance.data ?? 0n) < v;
    const noGas = gasless && v >= gaslessMin;
    title = `Deposit ${usdt(v)} USDT`;
    detail = noGas ? "From your wallet into your vault. You sign once and Kin pays the gas." : "From your wallet into your vault on Whitechain.";
    steps = [...(approve ? [{ ...token, functionName: "approve", args: [GHAR_VAULT, v], account: address }] : []), { ...vault, functionName: "deposit", args: [v], account: address }];
    cta = noGas ? "Deposit, no gas" : approve ? "Approve and deposit" : "Deposit";
    ok = `Deposited ${usdt(v)} USDT`;
    if (noGas) run = () => depositWithoutGas(address, v, setRelay).then((hash) => setRelay({ phase: "done", msg: `${ok} without gas`, hash }), (e) => setRelay({ phase: "error", msg: explain(e) }));
  } else {
    const per = BigInt(a.perPayment), cap = BigInt(a.perPeriod), period = BigInt(a.period);
    const limits = <>up to {usdt(per)} USDT per bill and {usdt(cap)} USDT per {days(a.period)}</>;
    if (a.kind === "add-payee") {
      title = `Add ${a.name}`;
      detail = <>Pays {limits}. Its biller <span className="mono">{short(a.biller)}</span> and payout <span className="mono">{a.payoutRef}</span> come from ENS.</>;
      steps = [{ ...vault, functionName: "setPayee", args: [namehash(a.name), a.biller, per, cap, period], account: address }];
      cta = "Add to vault";
      ok = `${a.name} added`;
    } else {
      title = "Grant the chat agent";
      detail = <>Lets <span className="mono">{short(a.agent)}</span> pay bills you approve in chat, {limits}. Revoke it any time on the Agent page.</>;
      steps = [{ ...vault, functionName: "setGrant", args: [a.agent, per, cap, period], account: address }];
      cta = "Set grant";
      ok = "Grant set";
    }
  }
  const overCap = a.kind !== "deposit" && BigInt(a.perPayment) > BigInt(a.perPeriod);
  return (
    <section className="bill" aria-label={title}>
      <p className="bill__title">{title}</p>
      <p className="bill__state">{detail}</p>
      {overCap && <p className="hint">The per-period cap also limits each bill, so the per-bill cap above it has no effect.</p>}
      {live
        ? tx.state.phase !== "done" && relay.phase !== "done" && (
          <button className="btn" disabled={tx.busy || relay.phase === "wallet" || relay.phase === "pending"} onClick={run}>{cta}</button>
        )
        : <p className="hint">Prepared earlier in this conversation. Ask again for a fresh card.</p>}
      <TxStatus state={relay.phase !== "idle" ? relay : tx.state} />
    </section>
  );
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.length > 4 && p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong>
      : p.length > 2 && p.startsWith("`") && p.endsWith("`") ? <code key={i}>{p.slice(1, -1)}</code>
      : p);
}

/** Paragraphs, lists, bold and inline code, built as React nodes so model text is never parsed as HTML. */
function Rich({ text, caret }: { text: string; caret: boolean }) {
  const blocks = blocksOf(text);
  const end = (i: number) => (caret && i === blocks.length - 1 ? <span className="caret" aria-hidden="true" /> : null);
  return (
    <div className="rich">
      {blocks.map(({ list, lines }, i) => {
        if (list) {
          const List = /^\s*\d/.test(lines[0]!) ? "ol" : "ul";
          return <List key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(LIST_ITEM, ""))}{j === lines.length - 1 && end(i)}</li>)}</List>;
        }
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}{end(i)}</p>;
      })}
    </div>
  );
}
