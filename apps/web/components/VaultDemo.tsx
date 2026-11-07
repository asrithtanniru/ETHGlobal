"use client";

import { useState, type ReactNode } from "react";
import { PAYEE_BOOK_PARENT } from "@ghar/shared";
import { Coin, Icon, Lines } from "./ui";

type Cap = "grant" | "reclaim" | "signed" | "payee" | "cap" | "nominee";

// Illustrative sample bill for the landing page; the card header says so.
const ROWS: { k: string; v: ReactNode; cap?: Cap; live?: boolean }[] = [
  { k: "payee", v: `rent.${PAYEE_BOOK_PARENT}`, cap: "payee" },
  { k: "invoice", v: "INV-0412" },
  { k: "amount", v: <>120.00 <Coin c="USDT" />USDT · paid out in <Coin c="INR" />INR</> },
  { k: "biller", v: "0x8a3…c21 · matches ENS record", cap: "signed" },
  { k: "cap", v: <>380 of 500 <Coin c="USDT" />USDT left · 30 days</>, cap: "cap" },
  { k: "payout", v: "verified by provider · ref ••4417" },
  { k: "status", v: "paying", cap: "grant", live: true },
  { k: "settle", v: "provider has 24 h, then reclaimable", cap: "reclaim" },
  { k: "nominee", v: "0x41c…7e2 · after 90 days silent", cap: "nominee" },
];

const CAPS: { id: Cap; t: string; b: string }[] = [
  { id: "grant", t: "Agent grants", b: "The agent spends only within the grant you set, per payment and per period. Revoke it any time" },
  { id: "reclaim", t: "Reclaim window", b: "If the provider doesn't settle within a day, anyone can return the USDT to your balance" },
  { id: "signed", t: "Signed bills", b: "A bill is paid only if the payee's registered biller signed it, and it expires after its due date" },
  { id: "payee", t: "Verified payees", b: "Money only goes to accounts a licensed payout provider wrote to the payee's ENS name" },
  { id: "cap", t: "Spending caps", b: "Every payment stays within the per-payee caps you set, enforced by the vault" },
  { id: "nominee", t: "Nominee takeover", b: "If you go silent past your chosen delay, the nominee you named can take over the balance" },
];

export function VaultDemo() {
  const [active, setActive] = useState<Cap>("grant");
  return (
    <section id="vault" className="band band--rule">
      <div className="frame vault">
        <div className="vault__left">
          <p className="eyebrow" data-fade>Vault</p>
          <h2 className="display-s" data-lines><Lines>{["Rules that live onchain,", "not on our servers."]}</Lines></h2>
          <p className="body-l" data-fade data-delay={0.15}>
            Every payment starts as a bill like this one. Pick a guarantee on the right — the line of the bill it checks lights up
          </p>
          <div className="record" data-fade data-delay={0.25}>
            <div className="record__head">
              <span className="mono">Bill</span>
              <span className="mono">sample · inv-0412 · due 2026-12-01</span>
            </div>
            <div className="record__rows">
              {ROWS.map((r) => {
                const I = r.cap ? Icon[r.cap] : null;
                return (
                  <div key={r.k} className={`record__row mono ${r.cap === active ? "is-active" : ""}`}>
                    {I ? <I /> : <span />}
                    <span className="k">{r.k}</span>
                    <span className="v">{r.v}{r.live && <span className="dots" aria-hidden="true" />}</span>
                  </div>
                );
              })}
            </div>
            <div className="record__foot"><p>Paid to the verified account, with a receipt on Arkiv</p></div>
          </div>
        </div>
        <div className="vl vault__right">
          <div className="caps-grid">
            {CAPS.map((c, i) => {
              const I = Icon[c.id];
              return (
                <div
                  key={c.id}
                  className={`cap ${active === c.id ? "is-active" : ""}`}
                  tabIndex={0}
                  onMouseEnter={() => setActive(c.id)}
                  onFocus={() => setActive(c.id)}
                  data-fade
                  data-delay={0.1 + i * 0.08}
                >
                  <I />
                  <h3 className="title">{c.t}</h3>
                  <p className="body">{c.b}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
