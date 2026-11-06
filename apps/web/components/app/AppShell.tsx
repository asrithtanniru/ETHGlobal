"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { settlementChain } from "@ghar/shared";
import { Logo } from "../ui";
import { explorerTx, short, wagmiConfig } from "@/lib/chain";
import type { TxState } from "./useTx";

const NAV = [
  ["Overview", "/app"],
  ["Payees", "/app/payees"],
  ["Bills", "/app/bills"],
  ["Agent", "/app/agent"],
  ["Activity", "/app/activity"],
  ["Nominee", "/app/nominee"],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <Header />
        <main className="app-main">{children}</main>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function Header() {
  const path = usePathname();
  const sub = useRef<HTMLElement>(null);
  // Phones: the sub-nav scrolls sideways; keep the current page's tab in view.
  useEffect(() => { sub.current?.querySelector("[aria-current]")?.scrollIntoView({ inline: "center", block: "nearest" }); }, [path]);
  return (
    <div className="sticky" style={{ transform: "none" }}>
      <div className="frame sticky__in">
        <div><Logo /></div>
        <div />
        <div>
          <nav className="nav" aria-label="App">
            {NAV.map(([l, href]) => (
              <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>{l}</Link>
            ))}
          </nav>
        </div>
        <div><WalletButton /></div>
      </div>
      <nav ref={sub} className="subnav app-subnav frame" aria-label="App mobile">
        {NAV.map(([l, href]) => (
          <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>{l}</Link>
        ))}
      </nav>
    </div>
  );
}

function WalletButton() {
  const { address, chainId, status } = useConnection();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending } = useSwitchChain();
  if (status !== "connected") return <ConnectButtons compact />;
  if (chainId !== settlementChain.id)
    return (
      <button className="btn" onClick={() => switchChain({ chainId: settlementChain.id })} disabled={isPending}>
        {isPending ? "Switching" : "Switch to Whitechain"}
      </button>
    );
  return (
    <button className="btn btn--ghost" onClick={() => disconnect()} title="Disconnect">
      <span className="mono">{short(address)}</span>
    </button>
  );
}

export function ConnectButtons({ compact = false }: { compact?: boolean }) {
  const connectors = useConnectors();
  const { connect, isPending, error } = useConnect();
  const hasWallet = typeof window !== "undefined" && "ethereum" in window;
  if (!hasWallet && !compact)
    return <p className="msg msg--err">No browser wallet found. Install one (for example MetaMask or Rabby) and reload.</p>;
  const c = connectors[0];
  return (
    <>
      <button className="btn" disabled={!c || isPending || !hasWallet} onClick={() => c && connect({ connector: c, chainId: settlementChain.id })}>
        {isPending ? "Connecting" : "Connect wallet"}
      </button>
      {!compact && error && <p className="msg msg--err">{error.message.split("\n")[0]}</p>}
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

/** Page header in the landing page's eyebrow + display heading pattern. */
export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="band band--rule">
      <div className="frame page-head">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display-s">{title}</h1>
        {children && <p className="body-l">{children}</p>}
      </div>
    </section>
  );
}

/** Wraps a page that needs a connected wallet on Whitechain Sepolia. */
export function RequireWallet({ children }: { children: (address: `0x${string}`) => ReactNode }) {
  const { address, chainId, status } = useConnection();
  if (status === "reconnecting" || status === "connecting") return <p className="frame empty">Checking your wallet<span className="dots" /></p>;
  if (!address || status !== "connected")
    return (
      <section className="band band--rule">
        <div className="frame panel">
          <h2 className="title-l">Connect a wallet to continue</h2>
          <p className="body-l" style={{ marginTop: "1.2rem" }}>Ghar reads your vault on Whitechain Sepolia and asks your wallet to sign every change.</p>
          <div className="form-actions"><ConnectButtons /></div>
        </div>
      </section>
    );
  if (chainId !== settlementChain.id)
    return (
      <section className="band band--rule">
        <div className="frame panel">
          <h2 className="title-l">Switch to Whitechain Sepolia</h2>
          <p className="body-l" style={{ marginTop: "1.2rem" }}>The vault lives on chain {settlementChain.id}. Use the button in the header to switch.</p>
        </div>
      </section>
    );
  return <>{children(address)}</>;
}
