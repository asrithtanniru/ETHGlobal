"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { isHash, type Address, type Hex } from "viem";
import { namehash } from "viem/ens";
import { useQuery } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import { PageHead, RequireWallet, TxStatus } from "@/components/app/AppShell";
import { Bill } from "@/components/app/Chat";
import { useChatSession } from "@/components/app/chatSession";
import { depositWithoutGas, gaslessMin, useGasless } from "@/components/app/gasless";
import type { TxState } from "@/components/app/useTx";
import { explain, short, usdt, vault } from "@/lib/chain";
import { rememberName } from "@/lib/names";

type WidgetBill = { digest: Hex; invoiceRef: string; amount: string; currency: string; dueDate: number; status: string };
type WidgetData = { payee: { name: string; payoutRef: string }; chatAgent: Address | null; bills: WidgetBill[] };

export default function PayPage() {
  const { digest } = useParams<{ digest: string }>();
  return (
    <div className="page">
      <PageHead title="Pay a bill">A payee sent you this bill. Kin checks it against Arkiv and ENS, then pays it from your vault once you approve.</PageHead>
      {isHash(digest) ? <RequireWallet>{(a) => <PayBill address={a} digest={digest} />}</RequireWallet> : <p className="msg msg--err">That bill link isn&apos;t valid.</p>}
    </div>
  );
}

function PayBill({ address, digest }: { address: Address; digest: Hex }) {
  const s = useChatSession(address);
  const q = useQuery({
    queryKey: ["widget", digest],
    queryFn: async () => {
      const r = await fetch(`/api/widget?digest=${digest}`);
      const j = (await r.json()) as WidgetData & { error?: string };
      if (!r.ok) throw new Error(j.error);
      return j;
    },
  });
  const payee = q.data?.payee.name;
  useEffect(() => { if (payee) rememberName(namehash(payee), payee); }, [payee]);
  const b = q.data?.bills[0];
  const agent = q.data?.chatAgent;
  const ready = useReadContracts({
    contracts: [
      { ...vault, functionName: "billerOf", args: [address, namehash(payee ?? "x.eth")] },
      { ...vault, functionName: "spendableOf", args: [address] },
      { ...vault, functionName: "availableToAgent", args: [address, agent ?? address] },
    ],
    query: { enabled: !!payee && !!agent, refetchInterval: 10_000 },
  });
  if (q.isLoading) return <p className="shimmer">Reading the bill from Arkiv</p>;
  if (q.error) return <p className="msg msg--err">{(q.error as Error).message}</p>;
  if (!b || !payee) return <p className="msg msg--err">This bill wasn&apos;t posted by the payee&apos;s verified biller, so Kin won&apos;t pay it.</p>;

  const amount = BigInt(b.amount);
  const [biller, balance, canSpend] = (ready.data ?? []).map((r) => r.result) as [Address | undefined, bigint | undefined, bigint | undefined];
  const inVault = !!biller && biller !== "0x0000000000000000000000000000000000000000";
  const short_ = balance !== undefined && balance < amount ? amount - balance : 0n;
  const tag = payee.split(".")[0]!;
  const family = payee.slice(tag.length + 1);

  // The card only offers Pay once every check passes; otherwise it names the first thing missing.
  const missing = b.status !== "open" ? b.status
    : ready.isLoading || balance === undefined ? "checking"
    : !inVault ? "not-in-vault" : short_ ? "balance-too-low" : !agent || (canSpend ?? 0n) < amount ? "over-agent-grant" : undefined;
  return (
    <div className="duo">
      <Bill bill={{ ...b, payee, payable: !missing, reason: missing }} address={address} ensure={s.ensure} />
      <section className="card">
        <h2 className="card__h">Before Kin can pay</h2>
        <ul className="ready">
          <li className={inVault ? "ok" : ""}>
            {inVault ? <>{payee} is in your vault</> : <><Link className="inline" href={`/app/payees?tag=${tag}&family=${family}`}>Add {payee} to your vault</Link> with caps that cover this bill</>}
          </li>
          <li className={balance !== undefined && !short_ ? "ok" : ""}>
            {balance === undefined ? "Checking your vault balance" : short_ ? <>Your vault needs {usdt(short_)} USDT more <TopUp address={address} amount={short_ < gaslessMin ? gaslessMin : short_} onDone={() => ready.refetch()} /></> : <>Your vault holds {usdt(balance)} USDT</>}
          </li>
          <li className={canSpend !== undefined && canSpend >= amount ? "ok" : ""}>
            {!agent ? "Chat payments aren't set up on this server"
              : canSpend !== undefined && canSpend >= amount ? <>The chat agent may pay it (up to {usdt(canSpend)} USDT now)</>
              : <><Link className="inline" href="/app/agent">Grant the chat agent</Link> <span className="mono">{short(agent)}</span> at least {usdt(amount)} USDT</>}
          </li>
        </ul>
        <p className="card__p">Your approval is a free signature. Kin&apos;s agent pays the gas, and the provider pays the payee in {b.currency}.</p>
      </section>
    </div>
  );
}

function TopUp({ address, amount, onDone }: { address: Address; amount: bigint; onDone: () => void }) {
  const gasless = useGasless();
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  if (!gasless) return <Link className="inline" href="/app/vault">Deposit on the Vault page</Link>;
  const busy = tx.phase === "wallet" || tx.phase === "pending";
  return (
    <>
      {tx.phase !== "done" && (
        <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => depositWithoutGas(address, amount, setTx).then(
          (hash) => { setTx({ phase: "done", msg: `Deposited ${usdt(amount)} USDT without gas`, hash }); onDone(); },
          (e) => setTx({ phase: "error", msg: explain(e) }))}>
          Deposit {usdt(amount)} USDT, no gas
        </button>
      )}
      <TxStatus state={tx} />
    </>
  );
}
