"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { createPublicClient, custom, http, parseEther, type Address, type EIP1193Provider, type Hex } from "viem";
import { useConnection } from "wagmi";
import { signTypedData, switchChain } from "wagmi/actions";
import { PAYEE_BOOK_PARENT, settlementChain } from "@ghar/shared";
import { buildPayeeName, getVerifiedPayee } from "@ghar/ens";
import { billDigest, billEntity, billTypedData, GharBill } from "@ghar/arkiv";
import { Coin } from "@/components/ui";
import { PageHead, TxStatus } from "@/components/app/AppShell";
import type { TxState } from "@/components/app/useTx";
import { ensClient, explain, parseUsdt, short, wagmiConfig } from "@/lib/chain";

export default function RaiseBill() {
  const { address, connector } = useConnection();
  return (
    <div className="page">
      <PageHead title="Raise a bill">
        For the payee. Sign a bill with your billing wallet and post it to the public Arkiv inbox. Kin only accepts it when this wallet is the biller in your ENS record.
      </PageHead>
      {address && connector && <Suspense><BillForm address={address} getProvider={() => connector.getProvider() as Promise<EIP1193Provider>} /></Suspense>}
    </div>
  );
}

const FAUCET = "https://hub.arkiv.network/faucet";
// Public endpoint: the browser never sees the server's access key. One write needs only a few calls.
const ARKIV_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network";

/** Moves the wallet to Rabdi, adding the network first if the wallet doesn't know it. */
async function switchToRabdi(provider: EIP1193Provider, chain: ReturnType<typeof rabdi>) {
  const chainId = `0x${chain.id.toString(16)}` as const;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    const code = (e as { code?: number; data?: { originalError?: { code?: number } } }).code;
    if (code !== 4902 && (e as { data?: { originalError?: { code?: number } } }).data?.originalError?.code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId, chainName: "Arkiv Rabdi", nativeCurrency: chain.nativeCurrency, rpcUrls: [ARKIV_RPC], blockExplorerUrls: [chain.blockExplorers.default.url] }],
    });
  }
}

function BillForm({ address, getProvider }: { address: Address; getProvider: () => Promise<EIP1193Provider> }) {
  // ?payee=<tag>.<family> from the merchant widget's Raise a bill button.
  const preset = useSearchParams().get("payee")?.toLowerCase() ?? "";
  const cut = preset.indexOf(".");
  const [family, setFamily] = useState(cut > 0 ? preset.slice(cut + 1) : PAYEE_BOOK_PARENT);
  const [tag, setTag] = useState(cut > 0 ? preset.slice(0, cut) : "");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("14");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [note, setNote] = useState("");
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  const [posted, setPosted] = useState<{ name: string; digest: Hex; txHash: Hex } | null>(null);

  let name = "";
  let nameErr = "";
  try { if (tag.trim()) name = buildPayeeName(family, tag); } catch (e) { nameErr = (e as Error).message; }
  const value = parseUsdt(amount);
  const d = Number(days);
  const ready = name && !nameErr && value && Number.isInteger(d) && d >= 1 && d <= 365 && invoiceRef.trim() && /^[A-Z]{3}$/.test(currency);
  const busy = tx.phase === "wallet" || tx.phase === "pending";

  async function submit() {
    setPosted(null);
    try {
      setTx({ phase: "pending", msg: "Reading the payee's ENS records" });
      const payee = await getVerifiedPayee(ensClient as never, name).catch(() => {
        throw new Error(`${name} has no verified records yet. The provider onboards the payee first.`);
      });
      if (payee.biller.toLowerCase() !== address.toLowerCase())
        throw new Error(`This wallet isn't ${payee.name}'s biller. ENS lists ${short(payee.biller)}, so connect that wallet.`);
      const bill = { payee: payee.name, invoiceRef: invoiceRef.trim(), amount: value!, dueDate: Math.floor(Date.now() / 1000) + d * 86_400, currency, note: note.trim() || undefined };

      const chain = rabdi({ accessKey: "" });
      const reader = createPublicClient({ chain, transport: http(ARKIV_RPC) });
      // Gas 1,000,000 at the current price is the most this write can cost.
      if ((await reader.getBalance({ address })) < 1_000_000n * (await reader.getGasPrice()) + parseEther("0.0001"))
        throw new Error(`This wallet needs test GLM on Arkiv Rabdi to post. Get some at ${FAUCET}, then try again.`);

      // MetaMask only signs typed data whose chainId matches the wallet's network, so sign on Whitechain.
      setTx({ phase: "wallet", msg: "Sign the bill in your wallet (no gas)" });
      await switchChain(wagmiConfig, { chainId: settlementChain.id });
      const signature = await signTypedData(wagmiConfig, billTypedData(bill));

      setTx({ phase: "wallet", msg: "Switch to Arkiv Rabdi and confirm the post in your wallet" });
      const provider = await getProvider();
      await switchToRabdi(provider, chain);
      const writer = createWalletClient({ chain, transport: custom(provider), account: address });
      const { values, options } = billEntity(bill, signature);
      // Arkiv's single-create floor; a bill's estimate is far below half of it. No automatic resend after a failure.
      const result = await writer.createEntity(GharBill, values as never, options as never, { gas: 1_000_000n });
      setTx({ phase: "done", msg: `Bill ${bill.invoiceRef} posted for ${payee.name}` });
      setPosted({ name: payee.name, digest: billDigest(bill), txHash: result.txHash as Hex });
      setInvoiceRef(""); setAmount(""); setNote("");
    } catch (e) {
      setTx({ phase: "error", msg: explain(e) });
    } finally {
      await switchChain(wagmiConfig, { chainId: settlementChain.id }).catch(() => undefined);
    }
  }

  return (
    <div className="duo">
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) submit(); }}>
        <h2 className="card__h">New bill</h2>
        <div className="fields2">
          <div className="field">
            <label htmlFor="rb-family">Family name</label>
            <input id="rb-family" value={family} onChange={(e) => setFamily(e.target.value.trim().toLowerCase())} />
          </div>
          <div className="field">
            <label htmlFor="rb-tag">Bill type</label>
            <input id="rb-tag" placeholder="university" value={tag} onChange={(e) => setTag(e.target.value)} aria-invalid={!!nameErr} />
          </div>
        </div>
        <span className="hint hint--block">{nameErr || (name ? `Bill for ${name}` : `Becomes tag.${family}`)}</span>
        <div className="fields2">
          <div className="field">
            <label htmlFor="rb-amount">Amount (USDT)</label>
            <input id="rb-amount" inputMode="decimal" placeholder="5.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rb-days">Due in (days)</label>
            <input id="rb-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rb-ref">Invoice number</label>
            <input id="rb-ref" className="mono" placeholder="FEES-2026-02" maxLength={64} value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rb-cur"><Coin c={currency} />Local currency</label>
            <input id="rb-cur" className="mono" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="rb-note">Note (optional)</label>
          <input id="rb-note" maxLength={140} placeholder="Spring term tuition" value={note} onChange={(e) => setNote(e.target.value)} />
          <span className="hint">Public on Arkiv. Leave out names and account numbers.</span>
        </div>
        <div className="form-actions"><button className="btn" disabled={!ready || busy}>{busy ? "Posting" : "Sign and post"}</button></div>
        <TxStatus state={tx} />
        {posted && (
          <p className="msg">
            <a className="link" href={`https://rabdi.explorer.arkiv.network/tx/${posted.txHash}`} target="_blank" rel="noreferrer">See it on Arkiv <span aria-hidden="true">→</span></a>
            {" "}<Link className="link" href={`/app/bills?payee=${encodeURIComponent(posted.name)}`}>Open the inbox <span aria-hidden="true">→</span></Link>
          </p>
        )}
      </form>
      <section className="card">
        <h2 className="card__h">What happens</h2>
        <ol className="howto">
          <li>Your wallet signs the bill. The signature covers the payee, invoice number, amount and due date, so none of them can be changed later.</li>
          <li>Your wallet posts it to Arkiv. Arkiv records your wallet as the creator, and the agent only reads bills created by the biller in ENS.</li>
          <li>The family&apos;s agent, or the family in chat, pays it from their vault within their caps. The vault pays each bill once.</li>
        </ol>
        <p className="card__p">The post needs a little test GLM on Arkiv Rabdi: <a href={FAUCET} target="_blank" rel="noreferrer">faucet</a></p>
      </section>
    </div>
  );
}
