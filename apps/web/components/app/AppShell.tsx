"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { settlementChain } from "@ghar/shared";
import { Icon, Logo } from "../ui";
import { explorerTx, short, wagmiConfig } from "@/lib/chain";
import type { TxState } from "./useTx";
import { ChatHistory } from "./ChatHistory";

const NAV = [
  ["New chat", "/app", Icon.chat],
  ["Vault", "/app/vault", Icon.home],
  ["Payees", "/app/payees", Icon.payee],
  ["Bills", "/app/bills", Icon.receipt],
  ["Agent", "/app/agent", Icon.grant],
  ["Activity", "/app/activity", Icon.activity],
  ["Pay with Direct", "/app/direct", Icon.bank],
  ["Nominee", "/app/nominee", Icon.nominee],
] as const;

/** Screens for the other parties, so a demo can show every role from one app. */
const ROLES = [
  ["Onboard a payee", "/app/onboard", Icon.signed],
  ["Raise a bill", "/app/raise-bill", Icon.receipt],
  ["Pay out bills", "/app/provider", Icon.bank],
] as const;

/** Public reads a family member can use without a wallet; every other screen sits behind the sign-in. */
const OPEN_PATHS = ["/app/bills", "/app/activity", "/app/provider"];

export function AppShell({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <Gate>{children}</Gate>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { status } = useConnection();
  if (status === "connected" || OPEN_PATHS.includes(path)) return <Dashboard>{children}</Dashboard>;
  if (status === "reconnecting") return <p className="signin-wait">Checking your wallet<span className="dots" /></p>;
  return <SignIn />; // stays up through "connecting" so a rejected request can show its error
}

function SignIn() {
  return (
    <div className="signin">
      <div className="signin__panel">
        <Logo />
        <div>
          <h1 className="signin__h">Open your vault</h1>
          <p className="signin__p">Kin reads your vault on Whitechain Sepolia and asks your wallet to sign every change.</p>
          <div className="form-actions"><ConnectButtons /></div>
        </div>
        <p className="signin__alt">
          No wallet on this device? You can still <Link href="/app/bills">read a payee&apos;s bills</Link> or <Link href="/app/activity">look up payouts</Link>.
        </p>
      </div>
      <div className="signin__art"><img src="/art/vault.webp" width={705} height={515} alt="" /></div>
    </div>
  );
}

function Dashboard({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="dash">
      <aside className="side">
        <div className="side__logo"><Logo /></div>
        <nav className="side__nav" aria-label="Dashboard">
          {NAV.map(([label, href, Glyph]) => (
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
              <Glyph /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <nav className="side__nav side__roles" aria-label="Provider and payee">
          <p className="hist__h">Provider and payee</p>
          {ROLES.map(([label, href, Glyph]) => (
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
              <Glyph /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <ChatHistory />
        <Wallet />
      </aside>
      <main className="dash__main">{children}</main>
    </div>
  );
}

function Wallet() {
  const { address, chainId, status } = useConnection();
  const { disconnect } = useDisconnect();
  if (status !== "connected") return <div className="side__wallet"><ConnectButtons compact /></div>;
  const wrongChain = chainId !== settlementChain.id;
  return (
    <div className="side__wallet">
      <p className="side__net"><span className={`dot${wrongChain ? " dot--off" : ""}`} />{wrongChain ? "Wrong network" : "Whitechain Sepolia"}</p>
      <div className="side__me">
        <span className="mono" title={address}>{short(address)}</span>
        <button className="side__out" onClick={() => disconnect()}>Disconnect</button>
      </div>
      {wrongChain && <SwitchChain />}
    </div>
  );
}

function SwitchChain() {
  const { switchChain, isPending } = useSwitchChain();
  return (
    <button className="btn" onClick={() => switchChain({ chainId: settlementChain.id })} disabled={isPending}>
      {isPending ? "Switching" : "Switch to Whitechain"}
    </button>
  );
}

export function ConnectButtons({ compact = false }: { compact?: boolean }) {
  const connectors = useConnectors();
  const { connect, isPending, error } = useConnect();
  // Assume a wallet until mounted: the server can't see window.ethereum, and this is the first thing on screen.
  const [hasWallet, setHasWallet] = useState(true);
  useEffect(() => setHasWallet("ethereum" in window), []);
  if (!hasWallet && !compact)
    return <p className="msg msg--err">No browser wallet found. Install one (for example MetaMask or Rabby) and reload.</p>;
  const c = connectors[0];
  return (
    <>
      <button className="btn" disabled={!c || isPending || !hasWallet} onClick={() => c && connect({ connector: c, chainId: settlementChain.id })}>
        {isPending ? "Connecting" : "Connect wallet"}
      </button>
      {!compact && error && (
        <p className="msg msg--err">
          {/already pending/i.test(error.message)
            ? "Your wallet already has a connection request open. Click the wallet's icon in the browser toolbar to approve or reject it."
            : error.message.split("\n")[0]}
        </p>
      )}
    </>
  );
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.phase === "idle") return <p className="msg" aria-live="polite" />;
  const cls = state.phase === "error" ? "msg msg--err" : state.phase === "done" ? "msg msg--ok" : "msg";
  return (
    <p className={cls} aria-live="polite">
      {state.msg}
      {(state.phase === "wallet" || state.phase === "pending") && <span className="dots" aria-hidden="true" />}
      {state.hash && (
        <> · <a className="mono" href={explorerTx(state.hash)} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{short(state.hash)}</a></>
      )}
    </p>
  );
}

/** Screen title and the one line that explains it. */
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-top">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

/** Hands a page the signed-in address once the wallet is on Whitechain Sepolia. Gate already keeps wallet-less visitors out. */
export function RequireWallet({ children }: { children: (address: `0x${string}`) => ReactNode }) {
  const { address, chainId } = useConnection();
  if (!address) return null;
  if (chainId !== settlementChain.id)
    return (
      <section className="card">
        <h2 className="card__h">Switch to Whitechain Sepolia</h2>
        <p className="card__p">The vault lives on chain {settlementChain.id}.</p>
        <div className="form-actions"><SwitchChain /></div>
      </section>
    );
  return <>{children(address)}</>;
}
