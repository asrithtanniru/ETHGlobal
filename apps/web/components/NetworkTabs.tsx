"use client";

import { useState } from "react";

// Facts from README "Components" and contracts/src/GharVault.sol; no customer claims.
const TABS = [
  {
    label: "Whitechain vault",
    text: "Holds your USDT and enforces agent grants, payee caps and the nominee timer.",
    by: "Whitechain Sepolia · chain 1874",
    stats: [["1", "day", "settle window before reclaim"], ["2", "caps", "per payee: payment and period"], ["0", "admins", "who can redirect funds"]],
  },
  {
    label: "ENSv2 payee book",
    text: "One name per payee. Only the provider's verifier can write where the money goes.",
    by: "Ethereum Sepolia · gharfam.eth",
    stats: [["1", "name", "per payee and bill type"], ["2", "records", "payout account and biller"], ["1", "writer", "the provider's verifier"]],
  },
  {
    label: "Arkiv inbox",
    text: "Signed bills that expire after the due date, and receipts the family can read.",
    by: "Arkiv Rabdi · chain 7794095",
    stats: [["1", "biller", "wallet allowed per payee"], ["0", "bills", "payable after their due date"], ["1", "receipt", "per settled payout"]],
  },
] as const;

export function NetworkTabs() {
  const [i, setI] = useState(0);
  // Reveal attributes only on first render; content swapped in by a tab click is shown as-is.
  const [touched, setTouched] = useState(false);
  const pick = (n: number, focus = false) => {
    setTouched(true); setI(n);
    if (focus) document.getElementById(`net-tab-${n}`)?.focus();
  };
  const lines = touched ? {} : { "data-lines": "" };
  const fade = (d = 0) => (touched ? {} : { "data-fade": "", "data-delay": d });
  const t = TABS[i]!;
  return (
    <section id="networks" className="band band--rule">
      <div className="frame net">
        <div className="net__side">
          <p className="eyebrow" data-fade>Networks</p>
          <div className="tabs" role="tablist" aria-label="Networks" data-fade data-delay={0.1}>
            {TABS.map((tab, n) => (
              <button
                key={tab.label}
                role="tab"
                id={`net-tab-${n}`}
                aria-selected={n === i}
                tabIndex={n === i ? 0 : -1}
                aria-controls="net-panel"
                className="tab"
                onClick={() => pick(n)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowRight") pick((n + 1) % TABS.length, true);
                  if (e.key === "ArrowUp" || e.key === "ArrowLeft") pick((n + TABS.length - 1) % TABS.length, true);
                }}
              >
                <span className="numeral">0{n + 1}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="vl net__main" id="net-panel" role="tabpanel" aria-labelledby={`net-tab-${i}`}>
          <p className="quote" {...lines} key={`q${i}`}>{t.text}</p>
          <p className="body-l net__by" {...fade(0.15)}>{t.by}</p>
          <div className="net__stats">
            {t.stats.map(([n, u, c], k) => (
              <div key={`${i}-${c}`} {...fade(0.2 + 0.1 * k)}>
                <div className="stat-n">{n}<small>{u}</small></div>
                <p className="body-l">{c}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
