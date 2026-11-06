import Link from "next/link";
import { PAYEE_BOOK_PARENT } from "@ghar/shared";
import { DOCS, Lines, Logo, REPO, TextLink, VAULT_EXPLORER } from "./ui";
import { VaultDemo } from "./VaultDemo";
import { NetworkTabs } from "./NetworkTabs";

const NAV = [
  ["How it works", "#how"],
  ["Vault", "#vault"],
  ["Bills", "#bills"],
  ["Guarantees", "#guarantees"],
  ["Networks", "#networks"],
] as const;

function Nav({ load = false }: { load?: boolean }) {
  return (
    <nav className="nav" aria-label="Sections">
      {NAV.map(([label, href]) => (
        <a key={href} href={href} {...(load ? { "data-load": "nav" } : {})}>
          {label}
        </a>
      ))}
    </nav>
  );
}

function MobileNav() {
  return (
    <details className="menu-btn">
      <summary className="btn btn--ghost" aria-label="Menu">Menu</summary>
      <div className="mobile-menu">
        {NAV.map(([label, href]) => (
          <a key={href} href={href}>{label}</a>
        ))}
        <Link href="/app" className="btn">Open app</Link>
      </div>
    </details>
  );
}

export function StickyHeader() {
  return (
    <div className="sticky" data-sticky inert>
      <div className="frame sticky__in">
        <div><Logo /></div>
        <div />
        <div><Nav /></div>
        <div><Link href="/app" className="btn">Open app</Link><MobileNav /></div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="band band--rule band--intro hdr">
      <div className="frame hdr__grid">
        <div className="hdr__logo" data-load="logo"><Logo /></div>
        <div className="vl" />
        <div className="vl hdr__nav"><Nav load /></div>
        <div className="vl hdr__cta">
          <Link href="/app" className="btn" data-load="demo">Open app</Link>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <>
      <section className="band band--rule band--intro" aria-labelledby="hero-title">
        <div className="frame hero__art-cell">
          <h1 id="hero-title" className="display-xl hero__title" data-lines="load">
            <Lines>{["Pay the bills back home", "from your stablecoins"]}</Lines>
          </h1>
          <img className="hero__art" src="/art/hero.webp" width={1040} height={589} alt="Engraved family home with a tiled roof and veranda, a water tank on the terrace, coconut palms behind and a power line running in" fetchPriority="high" />
        </div>
      </section>
      <section className="band band--rule band--intro band--heroot">
        <div className="frame hero__foot">
          <p className="body-l hero__lede" data-load="lede">
            Kin holds your USDT in an onchain vault and pays your family&apos;s bills, only to accounts a licensed provider verified
          </p>
          <div className="hero__ctas">
            <Link href="/app" className="btn" data-load="cta">Open the vault</Link>
            <span data-load="cta"><TextLink href={DOCS}>Read the docs</TextLink></span>
          </div>
        </div>
      </section>
    </>
  );
}

function Problem() {
  return (
    <section className="band band--rule">
      <div className="frame cols4 problem">
        <h2 className="display-l cell problem__title" data-lines>
          <Lines>{["Bank details can be forged.", "Your payee book can't be."]}</Lines>
        </h2>
        <p className="body-l cell vl problem__lede" data-fade data-delay={0.2}>
          A message saying &ldquo;we changed our account, pay here&rdquo; is all it takes to redirect a transfer. Kin only pays accounts a licensed provider verified, so a forged request has nowhere to send the money
        </p>
      </div>
    </section>
  );
}

const STEPS = [
  ["I", "Fund", "Deposit USDT into the vault once, set spending caps and name a nominee", "/art/step-1.webp", 230, 175, "Engraved strongbox with a coin dropping into its slot, stacks of coins beside it"],
  ["II", "Verify", "The agent pays a bill only if its biller and payout account match the payee's ENS records", "/art/step-2.webp", 263, 172, "Engraved bill with a wax seal, a magnifying glass showing a tick"],
  ["III", "Settle", "A licensed provider pays the bank in local currency and writes a receipt your family can read", "/art/step-3.webp", 210, 176, "Engraved bank with columns and a pediment"],
] as const;

function How() {
  return (
    <section id="how" className="band band--rule">
      <div className="frame cols4 how">
        <div className="cell how__intro">
          <p className="eyebrow" data-fade>How it works</p>
          <h2 className="display-s" data-lines><Lines>{["From a bill", "to a bank,", "in three", "steps."]}</Lines></h2>
        </div>
        {STEPS.map(([n, t, b, src, w, h, alt], i) => (
          <div key={n} className={`cell step ${i === 0 ? "vl" : ""}`}>
            <div className="step__art"><img src={src} width={w} height={h} alt={alt} data-wipe data-delay={0.15 + i * 0.12} loading="lazy" /></div>
            <div data-fade data-delay={0.1 + i * 0.1}>
              <span className="numeral step__n">{n}</span>
              <h3 className="title step__t">{t}</h3>
              <p className="body step__b">{b}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const BILLS = [
  ["Rent", `Paid monthly to the landlord's verified account at rent.${PAYEE_BOOK_PARENT}`, "rent"],
  ["School fees", `Term fees to the school's account at school-fees.${PAYEE_BOOK_PARENT}, capped per term`, "school-fees"],
  ["Clinic visits", "Bills from the clinic's own wallet, paid only up to the cap you set", "clinic"],
  ["Any bill you name", `Each new tag becomes its own payee name, for example electricity.${PAYEE_BOOK_PARENT}`, ""],
] as const;

function Bills() {
  return (
    <section id="bills" className="band band--rule">
      <div className="frame">
        <div className="bills__intro">
          <div>
            <p className="eyebrow" data-fade>Bills</p>
            <h2 className="display-s" data-lines><Lines>{["Where a wrong account", "costs a month."]}</Lines></h2>
          </div>
          <p className="body-l" data-fade data-delay={0.15}>Each bill type gets its own payee name, so a cap on rent never touches school fees</p>
        </div>
        <ul className="rows">
          {BILLS.map(([t, d, tag], i) => (
            <li key={t}>
              <Link className="row" href={tag ? `/app/payees?tag=${tag}` : "/app/payees"} data-fade data-delay={0.1 + i * 0.1}>
                <span className="title-l">{t}</span>
                <span className="body-l">{d}</span>
                <span className="row__arrow" aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Guarantees() {
  const rows = [
    ["0", "", "Payments to unverified accounts", "The provider re-checks ENS before every payout"],
    ["100", "%", "Bills signed by the biller", "Unsigned or expired bills can't be paid"],
    ["24", "h", "Settle window", "Then anyone can return the USDT to your balance"],
  ] as const;
  return (
    <section id="guarantees" className="band band--rule">
      <div className="frame guard">
        <div className="guard__left">
          <p className="eyebrow" data-fade>Guarantees</p>
          <h2 className="display-m" data-lines><Lines>{["Your money only reaches", "verified accounts."]}</Lines></h2>
          <div className="stats">
            {rows.map(([n, u, t, b], i) => (
              <div key={t} className="stat-row" data-fade data-delay={0.1 + i * 0.15}>
                <div className="stat-n"><span {...(n === "100" ? { "data-count": n } : {})}>{n}</span>{u && <small>{u}</small>}</div>
                <div><h3 className="title">{t}</h3><p className="body-l">{b}</p></div>
              </div>
            ))}
          </div>
          <p className="caps" data-fade>Whitechain Sepolia · ENSv2 Sepolia · Arkiv Rabdi · MIT</p>
        </div>
        <div className="vl guard__art">
          <img src="/art/vault.webp" width={705} height={515} alt="Engraved round vault door with locking bolts and a spoked wheel, set in a stone wall" data-wipe loading="lazy" />
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="band band--rule">
      <div className="frame cta">
        <h2 className="display-l cta__l" data-lines><Lines>{["Put family bills", "on autopilot."]}</Lines></h2>
        <div className="vl cta__r">
          <p className="body-l" data-fade data-delay={0.15}>Fund a vault on Whitechain Sepolia and pay a test bill in a few minutes</p>
          <div className="cta__actions" data-fade data-delay={0.25}>
            <Link href="/app" className="btn">Open the vault</Link>
            <TextLink href={DOCS}>Read the docs</TextLink>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const cols = [
    ["Product", [["Vault", "#vault"], ["Bills", "#bills"], ["Guarantees", "#guarantees"]]],
    ["Project", [["GitHub", REPO], ["Open app", "/app"], ["Nominee access", "/app/nominee"]]],
    ["Resources", [["Docs", DOCS], ["Vault on explorer", VAULT_EXPLORER], ["Contracts", `${REPO}/tree/main/contracts`]]],
  ] as const;
  return (
    <footer className="foot">
      <div className="frame">
        <div className="cols4 foot__cols">
          <div className="foot__brand" data-footlogo>
            <Logo />
            <p className="tag">Bills back home, paid from stablecoins</p>
            <p className="copy">© 2026 Kin · MIT</p>
          </div>
          {cols.map(([h, links], i) => (
            <div key={h} className="vl" data-fade data-delay={0.1 * i}>
              <h2 className="foot__h">{h}</h2>
              <ul className="foot__links">
                {links.map(([l, href]) => (
                  <li key={l}>
                    {href.startsWith("http") ? <a href={href} target="_blank" rel="noreferrer">{l}</a> : <a href={href}>{l}</a>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <img className="foot__range" src="/art/range.webp" width={1722} height={840} alt="" data-wipe loading="lazy" />
    </footer>
  );
}

export function Landing() {
  return (
    <>
      <StickyHeader />
      <Header />
      <main>
        <Hero />
        <Problem />
        <How />
        <VaultDemo />
        <Bills />
        <Guarantees />
        <NetworkTabs />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
