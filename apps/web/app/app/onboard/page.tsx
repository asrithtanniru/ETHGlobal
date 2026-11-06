"use client";

import { useState } from "react";
import Link from "next/link";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { useConnection } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { ensChain, PAYEE_BOOK_PARENT, PAYEE_BOOK_RESOLVER, settlementChain } from "@ghar/shared";
import { buildPayeeName, parsePayeeName, resolverAbi, ROLE_SET_TEXT, setVerifiedPayee } from "@ghar/ens";
import { PageHead, TxStatus } from "@/components/app/AppShell";
import type { TxState } from "@/components/app/useTx";
import { ensClient, explain, wagmiConfig } from "@/lib/chain";

export default function Onboard() {
  const { address } = useConnection();
  return (
    <div className="page">
      <PageHead title="Onboard a payee">
        For the payout provider. Once you have verified a payee&apos;s bank account, write its payout reference and billing wallet to ENS.
        Only the provider&apos;s verifier wallet can write these records, and Kin pays nowhere else.
      </PageHead>
      {address && <OnboardForm address={address} />}
    </div>
  );
}

const sepoliaTx = (h: Hex) => `${ensChain.blockExplorers?.default.url ?? "https://sepolia.etherscan.io"}/tx/${h}`;

function OnboardForm({ address }: { address: Address }) {
  const [family, setFamily] = useState(PAYEE_BOOK_PARENT);
  const [tag, setTag] = useState("");
  const [payoutRef, setPayoutRef] = useState("");
  const [biller, setBiller] = useState("");
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  const [done, setDone] = useState<{ name: string; hash: Hex } | null>(null);

  let name = "";
  let nameErr = "";
  try { if (tag.trim()) { name = buildPayeeName(family, tag); parsePayeeName(name); } } catch (e) { nameErr = (e as Error).message; }
  // ENS records are public: an account number must never be written there.
  const refErr = !payoutRef.trim() ? "" : payoutRef.length > 120 ? "Keep it under 120 characters." : /\d{8,}/.test(payoutRef) ? "This looks like an account number. ENS is public, so use your internal reference instead." : "";
  const billerErr = biller.trim() && !isAddress(biller.trim(), { strict: false }) ? "Enter a 0x wallet address." : "";
  const ready = name && !nameErr && payoutRef.trim() && !refErr && biller.trim() && !billerErr;
  const busy = tx.phase === "wallet" || tx.phase === "pending";

  async function submit() {
    setDone(null);
    try {
      setTx({ phase: "pending", msg: "Checking the payee book on ENS" });
      const resolver = await ensClient.getEnsResolver({ name: family });
      if (resolver?.toLowerCase() !== PAYEE_BOOK_RESOLVER.toLowerCase()) throw new Error(`${family} isn't set up as a payee book yet. Run the ENS setup script for it first.`);
      const canWrite = await ensClient.readContract({ address: resolver, abi: resolverAbi, functionName: "hasRootRoles", args: [ROLE_SET_TEXT, address] });
      if (!canWrite) throw new Error("This wallet can't write payee records. Connect the provider's verifier wallet.");
      setTx({ phase: "wallet", msg: "Switch to Sepolia and confirm in your wallet" });
      await switchChain(wagmiConfig, { chainId: ensChain.id });
      const wallet = await getWalletClient(wagmiConfig, { chainId: ensChain.id });
      const hash = await setVerifiedPayee(ensClient as never, wallet as never, { name, payoutRef: payoutRef.trim(), biller: getAddress(biller.trim()) });
      setTx({ phase: "pending", msg: "Waiting for Sepolia" });
      const r = await ensClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("The transaction reverted.");
      setTx({ phase: "done", msg: `${name} is verified` });
      setDone({ name, hash });
      setTag(""); setPayoutRef(""); setBiller("");
    } catch (e) {
      setTx({ phase: "error", msg: explain(e) });
    } finally {
      await switchChain(wagmiConfig, { chainId: settlementChain.id }).catch(() => undefined);
    }
  }

  return (
    <div className="duo">
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) submit(); }}>
        <h2 className="card__h">Payee records</h2>
        <div className="field">
          <label htmlFor="ob-family">Family name</label>
          <input id="ob-family" value={family} onChange={(e) => setFamily(e.target.value.trim().toLowerCase())} />
        </div>
        <div className="field">
          <label htmlFor="ob-tag">Bill type</label>
          <input id="ob-tag" placeholder="university" value={tag} onChange={(e) => setTag(e.target.value)} aria-invalid={!!nameErr} />
          <span className="hint">{nameErr || (name ? `Writes ${name}` : `Becomes tag.${family}`)}</span>
        </div>
        <div className="field">
          <label htmlFor="ob-ref">Payout reference</label>
          <input id="ob-ref" className="mono" placeholder="kyc:acct-univ-001" value={payoutRef} onChange={(e) => setPayoutRef(e.target.value)} aria-invalid={!!refErr} />
          <span className="hint">{refErr || "Your own reference to the verified bank account. Never the account number."}</span>
        </div>
        <div className="field">
          <label htmlFor="ob-biller">Biller wallet</label>
          <input id="ob-biller" className="mono" placeholder="0x…" value={biller} onChange={(e) => setBiller(e.target.value)} aria-invalid={!!billerErr} />
          <span className="hint">{billerErr || "The wallet the payee gave you for signing bills. Bills from any other wallet are ignored."}</span>
        </div>
        <div className="form-actions"><button className="btn" disabled={!ready || busy}>{busy ? "Writing" : "Write to ENS"}</button></div>
        <TxStatus state={tx} />
        {done && (
          <p className="msg">
            <a className="link" href={sepoliaTx(done.hash)} target="_blank" rel="noreferrer">See the Sepolia transaction <span aria-hidden="true">→</span></a>
            {" "}<Link className="link" href={`/app/payees?tag=${encodeURIComponent(done.name.split(".")[0]!)}`}>Add it to a vault <span aria-hidden="true">→</span></Link>
          </p>
        )}
      </form>
      <section className="card">
        <h2 className="card__h">What happens</h2>
        <ol className="howto">
          <li>You verify the payee&apos;s bank account off-chain and get a wallet from them for signing bills.</li>
          <li>This form writes <span className="mono">ghar.payoutRef</span> and <span className="mono">ghar.biller</span> on the payee&apos;s name. Existing records on that name are replaced.</li>
          <li>The family adds the name on the Payees page. The vault copies the biller from ENS, so nobody types it.</li>
          <li>The payee raises bills from that wallet on the <Link href="/app/raise-bill">Raise a bill</Link> page.</li>
        </ol>
      </section>
    </div>
  );
}
