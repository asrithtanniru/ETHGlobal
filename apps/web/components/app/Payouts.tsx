"use client";

import type { Address, Hex } from "viem";
import { useQuery } from "@tanstack/react-query";
import { Coin } from "@/components/ui";
import { TxStatus } from "@/components/app/AppShell";
import { TransakOrder } from "@/components/app/TransakOrder";
import { useTx } from "@/components/app/useTx";
import { chainClient, explain, explorerTx, short, usdt, vault, vaultEvents, when } from "@/lib/chain";
import { nameFor } from "@/lib/names";

const SETTLE_WINDOW = 86_400; // GharVault.SETTLE_WINDOW
const STATUS = ["none", "pending", "paid", "refunded"] as const;

type Payout = {
  digest: Hex; payee: Hex; sender: Address; amount: bigint; agent: Address; tx: Hex; requestedAt: bigint;
  status: (typeof STATUS)[number]; note?: string; settleTx?: Hex;
};

/**
 * Payouts read straight from the vault's events. `provider` shows every sender and the pay-out button;
 * `only` keeps the pending ones or the settled ones.
 */
export function Payouts({ filter, title, me, provider = false, only, empty }: {
  filter: { sender?: Address; payee?: Hex }; title: string; me?: Address; provider?: boolean; only?: "pending" | "settled"; empty?: string;
}) {
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
  const rows = q.data?.filter((p) => !only || (only === "pending") === (p.status === "pending"));
  return (
    <section className="card card--list">
      <h2 className="card__h">{title}</h2>
      {q.isLoading && <p className="empty">Reading payouts from Whitechain<span className="dots" /></p>}
      {q.error && <p className="empty msg--err">{explain(q.error)}</p>}
      {rows?.length === 0 && <p className="empty">{empty ?? "No payouts yet. The agent requests one when it pays a verified, signed bill."}</p>}
      {rows?.map((p) => <PayoutRow key={p.digest} p={p} me={me} provider={provider} onDone={() => q.refetch()} />)}
    </section>
  );
}

function PayoutRow({ p, me, provider, onDone }: { p: Payout; me?: Address; provider: boolean; onDone: () => void }) {
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
        <div className="title">{usdt(p.amount)} <Coin c="USDT" />USDT</div>
        <div className="mono" style={{ marginTop: "0.6rem" }}>{nameFor(p.payee) ?? short(p.payee)}</div>
      </div>
      <div className="body-l">
        <span className={`tag-pill ${p.status === "paid" ? "tag-pill--on" : ""}`}>{p.status}</span>{" "}
        requested {when(p.requestedAt)} by agent <span className="mono">{short(p.agent)}</span>
        {provider && <> from the vault of <span className="mono">{short(p.sender)}</span></>}
        {p.note && <> · {p.note}</>}
        {p.status === "pending" && !canReclaim && <> · provider has until {when(closesAt)}</>}
        <div className="mono" style={{ marginTop: "0.6rem" }}>
          <a href={explorerTx(p.tx)} target="_blank" rel="noreferrer">paid from the vault ↗</a>
          {p.settleTx && <> · <a href={explorerTx(p.settleTx)} target="_blank" rel="noreferrer">USDT released to the provider ↗</a></>}
          {receipt.data?.key && <> · <a href={`/receipt/${receipt.data.key}`}>receipt</a></>}
        </div>
        <TransakOrder digest={p.digest} payout={provider} />
        <TxStatus state={tx.state} />
      </div>
      {canReclaim && me ? (
        <button className="btn btn--ghost" disabled={tx.busy} onClick={() => tx.run([{ ...vault, functionName: "reclaim", args: [p.digest], account: me }] as never, "USDT returned to the sender's balance")}>Reclaim</button>
      ) : <span />}
    </div>
  );
}
