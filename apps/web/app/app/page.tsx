"use client";

import { useState } from "react";
import Link from "next/link";
import { erc20Abi, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { GHAR_VAULT, USDT, settlementChain } from "@ghar/shared";
import { PageHead, RequireWallet, TxStatus } from "@/components/app/AppShell";
import { Lines } from "@/components/ui";
import { useTx } from "@/components/app/useTx";
import { parseUsdt, short, usdt, vault, when } from "@/lib/chain";

export default function Overview() {
  return (
    <>
      <PageHead eyebrow="Vault" title={<Lines>{["Your vault on", "Whitechain Sepolia."]}</Lines>}>
        Deposit USDT once. The agent pays verified payees from this balance within the caps you set.
      </PageHead>
      <RequireWallet>{(a) => <Vault address={a} />}</RequireWallet>
    </>
  );
}

function Vault({ address }: { address: Address }) {
  const token = { address: USDT.address, abi: erc20Abi, chainId: settlementChain.id } as const;
  const { data, refetch } = useReadContracts({
    contracts: [
      { ...vault, functionName: "balanceOf", args: [address] },
      { ...token, functionName: "balanceOf", args: [address] },
      { ...vault, functionName: "nomineeOf", args: [address] },
      { ...vault, functionName: "lastActive", args: [address] },
    ],
  });
  const allowance = useReadContract({ ...token, functionName: "allowance", args: [address, GHAR_VAULT] });
  const [vaultBal, walletBal, nominee, lastActive] = data?.map((d) => d.result) ?? [];
  const nom = nominee as readonly [Address, bigint] | undefined;
  const refresh = () => { refetch(); allowance.refetch(); };

  return (
    <>
      <section className="band band--rule">
        <div className="frame app-stats">
          <div>
            <div className="stat-n">{usdt(vaultBal as bigint | undefined)}<small>USDT</small></div>
            <p className="body-l">in your vault</p>
          </div>
          <div className="vl">
            <div className="stat-n">{usdt(walletBal as bigint | undefined)}<small>USDT</small></div>
            <p className="body-l">in your wallet <span className="mono">{short(address)}</span></p>
          </div>
          <div className="vl">
            <div className="stat-n">{lastActive ? when(lastActive as bigint).split(",")[0] : "—"}</div>
            <p className="body-l">
              last active{nom && nom[0] !== "0x0000000000000000000000000000000000000000"
                ? <> · nominee <span className="mono">{short(nom[0])}</span> after {Number(nom[1]) / 86400} days</>
                : <> · <Link href="/app/nominee" style={{ textDecoration: "underline" }}>no nominee set</Link></>}
            </p>
          </div>
        </div>
      </section>
      <section className="band band--rule">
        <div className="frame split">
          <Deposit address={address} allowance={allowance.data} walletBal={walletBal as bigint | undefined} onDone={refresh} />
          <div className="vl"><Withdraw address={address} onDone={refresh} /></div>
        </div>
      </section>
      <section className="band band--rule">
        <div className="frame split">
          <CheckIn address={address} onDone={refresh} />
          <div className="vl panel">
            <h2 className="title-l">Next</h2>
            <ul className="foot__links" style={{ justifyItems: "start" }}>
              <li><Link href="/app/payees">Add a verified payee →</Link></li>
              <li><Link href="/app/agent">Give the agent a grant →</Link></li>
              <li><Link href="/app/activity">See payouts and receipts →</Link></li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}

function Deposit({ address, allowance, walletBal, onDone }: { address: Address; allowance?: bigint; walletBal?: bigint; onDone: () => void }) {
  const [amt, setAmt] = useState("");
  const tx = useTx(() => { setAmt(""); onDone(); });
  const v = parseUsdt(amt);
  const needsApproval = v !== undefined && (allowance ?? 0n) < v;
  const tooMuch = v !== undefined && walletBal !== undefined && v > walletBal;
  return (
    <form className="panel" onSubmit={(e) => {
      e.preventDefault();
      if (!v) return;
      const steps = [
        ...(needsApproval ? [{ address: USDT.address, abi: erc20Abi, functionName: "approve", args: [GHAR_VAULT, v], account: address, chainId: settlementChain.id } as const] : []),
        { ...vault, functionName: "deposit", args: [v], account: address } as const,
      ];
      tx.run(steps as never, `Deposited ${amt} USDT`);
    }}>
      <h2 className="title-l">Deposit</h2>
      <div className="field">
        <label htmlFor="dep">Amount (USDT)</label>
        <input id="dep" inputMode="decimal" placeholder="100.00" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <span className="hint">{tooMuch ? `Your wallet holds ${usdt(walletBal)} USDT.` : needsApproval ? "Your wallet will ask to approve USDT first, then to deposit." : "Moves USDT from your wallet into the vault."}</span>
      </div>
      <div className="form-actions"><button className="btn" disabled={!v || tooMuch || tx.busy}>{needsApproval ? "Approve and deposit" : "Deposit"}</button></div>
      <TxStatus state={tx.state} />
    </form>
  );
}

function Withdraw({ address, onDone }: { address: Address; onDone: () => void }) {
  const [amt, setAmt] = useState("");
  const [to, setTo] = useState("");
  const tx = useTx(() => { setAmt(""); onDone(); });
  const v = parseUsdt(amt);
  const dest = (to.trim() || address) as Address;
  const validTo = /^0x[0-9a-fA-F]{40}$/.test(dest);
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); if (v && validTo) tx.run([{ ...vault, functionName: "withdraw", args: [v, dest], account: address }] as never, `Withdrew ${amt} USDT`); }}>
      <h2 className="title-l">Withdraw</h2>
      <div className="field">
        <label htmlFor="wd">Amount (USDT)</label>
        <input id="wd" inputMode="decimal" placeholder="25.00" value={amt} onChange={(e) => setAmt(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="wdto">Send to</label>
        <input id="wdto" className="mono" placeholder={address} value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!validTo} />
        <span className="hint">{validTo ? "Leave empty to send back to this wallet." : "Enter a 0x address."}</span>
      </div>
      <div className="form-actions"><button className="btn" disabled={!v || !validTo || tx.busy}>Withdraw</button></div>
      <TxStatus state={tx.state} />
    </form>
  );
}

function CheckIn({ address, onDone }: { address: Address; onDone: () => void }) {
  const tx = useTx(onDone);
  return (
    <div className="panel">
      <h2 className="title-l">Check in</h2>
      <p className="body-l" style={{ marginTop: "1.2rem", maxWidth: "52rem" }}>
        Resets your nominee timer without changing anything else. Every deposit, withdrawal or setting change also counts.
      </p>
      <div className="form-actions">
        <button className="btn btn--ghost" disabled={tx.busy} onClick={() => tx.run([{ ...vault, functionName: "checkIn", account: address }] as never, "Checked in")}>Check in now</button>
      </div>
      <TxStatus state={tx.state} />
    </div>
  );
}
