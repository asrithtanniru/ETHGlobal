"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { useQuery } from "@tanstack/react-query";

// shortcut: links the dashboard's orders list, not the order itself (no documented per-order URL); search the ID there.
const DASHBOARD = "https://dashboard.transak.com/orders";
const FINAL = ["COMPLETED", "FAILED", "REFUNDED", "EXPIRED", "CANCELLED"];
const LABEL: Record<string, string> = {
  AWAITING_PAYMENT_FROM_USER: "waiting for the provider's ETH",
  PENDING_DELIVERY_FROM_TRANSAK: "Transak is paying out",
  COMPLETED: "paid out",
};

type View = {
  partnerOrderId: string; depositTx?: Hex; stage?: string; openable?: boolean; currency?: string;
  order: null | { id: string; status: string; fiatAmount?: number; fiatCurrency?: string; cryptoAmount?: number; fee?: number; card?: string };
};

/**
 * Transak's own record of a payout, so the off-ramp leg can be checked like the Whitechain one.
 * On the provider's page (`payout`), a pending payout with no order yet gets a button that opens Transak's widget for the payee.
 */
export function TransakOrder({ digest, payout = false }: { digest: Hex; payout?: boolean }) {
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState("");
  const q = useQuery({
    queryKey: ["transak", digest],
    queryFn: async (): Promise<View | null> => { const r = await fetch(`/api/transak?digest=${digest}`); return r.ok ? r.json() : null; },
    // Polling also moves the provider's steps forward, so it keeps going until the vault is settled.
    refetchInterval: (s) => (s.state.data?.order && FINAL.includes(s.state.data.order.status) && !s.state.data.stage ? false : 8_000),
  });

  async function open() {
    // Opened before the request so the browser treats it as a click, not a popup.
    const tab = window.open("", "_blank");
    setOpening(true); setErr("");
    try {
      const r = await fetch("/api/transak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest }) });
      const j = (await r.json().catch(() => ({}))) as { widgetUrl?: string; error?: string };
      if (!j.widgetUrl) throw new Error(j.error ?? "Couldn't open Transak.");
      if (tab) tab.location.href = j.widgetUrl; else window.location.href = j.widgetUrl;
    } catch (e) {
      tab?.close();
      setErr((e as Error).message);
    } finally {
      setOpening(false);
    }
  }

  const v = q.data;
  const inr = !v?.order && v?.currency === "INR";
  if (!v || (!v.order && !v.openable && !(payout && inr))) return null;
  const o = v.order;
  return (
    <div className="transak mono">
      <p>
        {o ? <>Transak order {o.id.slice(0, 8)}… · <b>{LABEL[o.status] ?? o.status.toLowerCase().replaceAll("_", " ")}</b>
          {o.fiatAmount !== undefined && <> · {o.fiatAmount} {o.fiatCurrency}{o.card && <> to card ••{o.card}</>}</>}
          {o.cryptoAmount !== undefined && <> · {o.cryptoAmount} ETH sold</>}</>
          : inr ? <>INR: P2P.me pays the UPI ID the friend enters on their claim link.</>
          : payout ? <>Transak order {v.partnerOrderId}: not opened yet.</>
          : <>Waiting for the payout provider to pay it out.</>}
        {v.depositTx && <> · <a href={`https://sepolia.etherscan.io/tx/${v.depositTx}`} target="_blank" rel="noreferrer">Sepolia deposit ↗</a></>}
        {o && <> · <a href={DASHBOARD} target="_blank" rel="noreferrer" title={`Search ${o.id} or ${v.partnerOrderId}`}>Partner dashboard ↗</a></>}
      </p>
      {!o && v.openable && payout && (
        <p className="transak__open">
          <button className="btn btn--ghost btn--sm" disabled={opening} onClick={open}>{opening ? "Opening Transak" : "Pay out through Transak ↗"}</button>
          <span>Opens the payee&apos;s Transak confirmation (5 minutes). On staging, confirm with the test card ••1519.</span>
        </p>
      )}
      {err && <p className="msg msg--err">{err}</p>}
    </div>
  );
}
