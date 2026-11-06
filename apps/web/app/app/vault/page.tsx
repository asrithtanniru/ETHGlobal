"use client";

import { useState } from "react";
import Link from "next/link";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { GHAR_VAULT, USDT, settlementChain } from "@ghar/shared";
import { PageHead, RequireWallet, TxStatus } from "@/components/app/AppShell";
import { useTx, type TxState } from "@/components/app/useTx";
import { depositWithoutGas, gaslessMin, useGasless } from "@/components/app/gasless";
import { explain, parseUsdt, short, usdt, vault, when } from "@/lib/chain";

export default function VaultPage() {
  return (
    <div className="page">
      <PageHead title="Vault">Deposit USDT once. The agent pays verified payees from this balance within the caps you set.</PageHead>
      <RequireWallet>{(a) => <Vault address={a} />}</RequireWallet>
    </div>
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
      { ...vault, functionName: "stakePlanOf", args: [address] },
      { ...vault, functionName: "stakeOf", args: [address] },
      { ...vault, functionName: "earnedOf", args: [address] },
      { ...vault, functionName: "rewardReserve" },
    ],
  });
  const allowance = useReadContract({ ...token, functionName: "allowance", args: [address, GHAR_VAULT] });
  const [vaultBal, walletBal, nominee, lastActive, plan, stake, earned, reserve] = data?.map((d) => d.result) ?? [];
  const nom = nominee as readonly [Address, bigint] | undefined;
  const refresh = () => { refetch(); allowance.refetch(); };

  return (
    <div className="stack">
      <section className="balances" aria-label="Balances">
        <div>
          <p className="balances__k">In your vault</p>
          <div className="stat-n">{usdt(vaultBal as bigint | undefined)}<small>USDT</small></div>
        </div>
        <div>
          <p className="balances__k">In your wallet</p>
          <div className="stat-n">{usdt(walletBal as bigint | undefined)}<small>USDT</small></div>
          <p className="balances__note mono">{short(address)}</p>
        </div>
        <div>
          <p className="balances__k">Last active</p>
          <div className="stat-n">{lastActive ? when(lastActive as bigint).split(",")[0] : "—"}</div>
          <p className="balances__note">
            {nom && nom[0] !== "0x0000000000000000000000000000000000000000"
              ? <>Nominee <span className="mono">{short(nom[0])}</span> after {Number(nom[1]) / 86400} days</>
              : <Link href="/app/nominee" style={{ textDecoration: "underline" }}>No nominee set</Link>}
          </p>
        </div>
      </section>
      <div className="overview">
        <Deposit address={address} allowance={allowance.data} walletBal={walletBal as bigint | undefined} onDone={refresh} />
        <Withdraw address={address} onDone={refresh} />
        <div className="overview__rail">
          <CheckIn address={address} onDone={refresh} />
          <Staking
            address={address}
            plan={plan as readonly [bigint, bigint] | undefined}
            staked={(stake as readonly [bigint, bigint, bigint] | undefined)?.[0]}
            earned={earned as bigint | undefined}
            reserve={reserve as bigint | undefined}
            onDone={refresh}
          />
          <section className="card">
            <h2 className="card__h">Next</h2>
            <ul className="next">
              <li><Link href="/app/payees">Add a verified payee <span aria-hidden="true">→</span></Link></li>
              <li><Link href="/app/agent">Give the agent a grant <span aria-hidden="true">→</span></Link></li>
              <li><Link href="/app/activity">See payouts and receipts <span aria-hidden="true">→</span></Link></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Deposit({ address, allowance, walletBal, onDone }: { address: Address; allowance?: bigint; walletBal?: bigint; onDone: () => void }) {
  const [amt, setAmt] = useState("");
  const tx = useTx(() => { setAmt(""); onDone(); });
  const [relay, setRelay] = useState<TxState>({ phase: "idle" });
  const gasless = useGasless();
  const v = parseUsdt(amt);
  const needsApproval = v !== undefined && (allowance ?? 0n) < v;
  const tooMuch = v !== undefined && walletBal !== undefined && v > walletBal;
  const noGas = gasless && v !== undefined && v >= gaslessMin;
  const busy = tx.busy || relay.phase === "wallet" || relay.phase === "pending";
  const withOwnGas = () => {
    if (!v) return;
    setRelay({ phase: "idle" });
    const steps = [
      ...(needsApproval ? [{ address: USDT.address, abi: erc20Abi, functionName: "approve", args: [GHAR_VAULT, v], account: address, chainId: settlementChain.id } as const] : []),
      { ...vault, functionName: "deposit", args: [v], account: address } as const,
    ];
    tx.run(steps as never, `Deposited ${amt} USDT`);
  };
  const withoutGas = async () => {
    if (!v) return;
    tx.reset();
    try {
      const hash = await depositWithoutGas(address, v, setRelay);
      setRelay({ phase: "done", msg: `Deposited ${amt} USDT without gas`, hash });
      setAmt(""); onDone();
    } catch (e) {
      setRelay({ phase: "error", msg: explain(e) });
    }
  };
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (noGas) withoutGas(); else withOwnGas(); }}>
      <h2 className="card__h">Deposit</h2>
      <div className="field">
        <label htmlFor="dep">Amount (USDT)</label>
        <input id="dep" inputMode="decimal" placeholder="100.00" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <span className="hint">
          {tooMuch ? `Your wallet holds ${usdt(walletBal)} USDT.`
            : noGas ? "You sign once and Kin pays the gas. No WBT needed."
            : needsApproval ? "Your wallet will ask to approve USDT first, then to deposit."
            : "Moves USDT from your wallet into the vault."}
        </span>
      </div>
      <div className="form-actions">
        <button className="btn" disabled={!v || tooMuch || busy}>{noGas ? "Deposit, no gas" : needsApproval ? "Approve and deposit" : "Deposit"}</button>
        {noGas && <button type="button" className="btn btn--ghost" disabled={tooMuch || busy} onClick={withOwnGas}>Use my own gas</button>}
      </div>
      <TxStatus state={relay.phase !== "idle" ? relay : tx.state} />
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
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (v && validTo) tx.run([{ ...vault, functionName: "withdraw", args: [v, dest], account: address }] as never, `Withdrew ${amt} USDT`); }}>
      <h2 className="card__h">Withdraw</h2>
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

function Staking({ address, plan, staked, earned, reserve, onDone }: { address: Address; plan?: readonly [bigint, bigint]; staked?: bigint; earned?: bigint; reserve?: bigint; onDone: () => void }) {
  const [days, setDays] = useState("");
  const [keep, setKeep] = useState("");
  const tx = useTx(() => { setDays(""); setKeep(""); onDone(); });
  const seconds = Math.round(Number(days) * 86400);
  const validDays = Number.isFinite(seconds) && seconds > 0;
  const k = Number(keep) === 0 ? 0n : parseUsdt(keep);
  const on = !!plan && plan[0] > 0n;
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (validDays && k !== undefined) tx.run([{ ...vault, functionName: "setStakePlan", args: [BigInt(seconds), k], account: address }] as never, "Stake plan saved"); }}>
      <h2 className="card__h">Stake when idle</h2>
      <p className="card__p">Test money only, at a fixed 5% a year paid from a test reserve. If you stay inactive, your balance above the amount you keep starts earning. It never leaves the vault, and bills still get paid.</p>
      {on && (
        <dl className="kv">
          <dt>after</dt><dd>{Number((Number(plan[0]) / 86400).toFixed(3))} days inactive</dd>
          <dt>keep</dt><dd>{usdt(plan[1])} USDT</dd>
          <dt>staked</dt><dd>{usdt(staked)} USDT</dd>
          <dt>earned</dt><dd>{earned === undefined ? "—" : formatUnits(earned, USDT.decimals)} USDT</dd>
          <dt>reserve</dt><dd>{usdt(reserve)} USDT</dd>
        </dl>
      )}
      <div className="field">
        <label htmlFor="sd">Days inactive</label>
        <input id="sd" inputMode="decimal" placeholder="30" value={days} onChange={(e) => setDays(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="sk">Keep for bills (USDT)</label>
        <input id="sk" inputMode="decimal" placeholder="0.00" value={keep} onChange={(e) => setKeep(e.target.value)} />
      </div>
      <div className="form-actions">
        <button className="btn" disabled={!validDays || k === undefined || tx.busy}>{on ? "Update plan" : "Allow staking"}</button>
        {!!staked && <button type="button" className="btn btn--ghost" disabled={tx.busy} onClick={() => tx.run([{ ...vault, functionName: "unstake", args: [address], account: address }] as never, "Unstaked")}>Unstake now</button>}
        {on && <button type="button" className="btn btn--ghost" disabled={tx.busy} onClick={() => tx.run([{ ...vault, functionName: "removeStakePlan", account: address }] as never, "Staking turned off")}>Turn off</button>}
      </div>
      <TxStatus state={tx.state} />
    </form>
  );
}

function CheckIn({ address, onDone }: { address: Address; onDone: () => void }) {
  const tx = useTx(onDone);
  return (
    <section className="card">
      <h2 className="card__h">Check in</h2>
      <p className="card__p">Resets your nominee timer without changing anything else. Every deposit, withdrawal or setting change also counts.</p>
      <div className="form-actions">
        <button className="btn btn--ghost" disabled={tx.busy} onClick={() => tx.run([{ ...vault, functionName: "checkIn", account: address }] as never, "Checked in")}>Check in now</button>
      </div>
      <TxStatus state={tx.state} />
    </section>
  );
}
