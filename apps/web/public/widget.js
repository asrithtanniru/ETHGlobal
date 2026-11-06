/*
 * Kin widget: drop-in USDT billing for a merchant site.
 *
 *   <script src="https://YOUR-GHAR-HOST/widget.js" defer></script>
 *   <ghar-invoice payee="university.gharfam.eth" invoice="FEES-2026"></ghar-invoice>   customer view
 *   <ghar-merchant payee="university.gharfam.eth"></ghar-merchant>                     merchant view
 *   document.addEventListener("ghar:status", (e) => console.log(e.detail));            status changes
 *
 * The data comes from Kin's public read API: bills on Arkiv from the payee's ENS biller, payout status
 * from the Whitechain vault, receipts from the provider. Everything shown is text, never HTML.
 */
(() => {
  const ORIGIN = new URL(document.currentScript.src).origin;
  const POLL_MS = 15000;

  const CSS = `
    :host { display: block; font: 14px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; color: #0e0d0b; --ink: #0e0d0b; --muted: #5e5d59; --line: #dcdad5; --paper: #fbfaf7; --sunk: #e8e7e4; }
    * { box-sizing: border-box; }
    .card { border: 1px solid var(--line); background: var(--paper); padding: 18px 20px; }
    .top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .amt { font-size: 28px; letter-spacing: -0.01em; }
    .amt small { font-size: 13px; color: var(--muted); margin-left: 6px; }
    .meta, .muted, .foot { color: var(--muted); }
    .meta { margin: 6px 0 14px; font: 12.5px ui-monospace, monospace; overflow-wrap: anywhere; }
    .pill { font: 12px ui-monospace, monospace; border: 1px solid var(--line); padding: 2px 7px; white-space: nowrap; }
    .pill.on { border-color: var(--ink); }
    button, a.btn { font: inherit; height: 40px; padding: 0 16px; border: 0; background: #141414; color: #f4f3ef; cursor: pointer; display: inline-flex; align-items: center; text-decoration: none; }
    button:hover, a.btn:hover { background: #2a2927; }
    button.ghost { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1px #c2c1bd; }
    a { color: var(--ink); }
    .foot { margin-top: 14px; font-size: 12px; }
    .err { color: var(--ink); }
    .sum { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--line); background: var(--paper); margin-bottom: 12px; }
    .sum div { padding: 12px 14px; } .sum div + div { border-left: 1px solid var(--line); }
    .sum b { display: block; font-size: 20px; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; background: var(--paper); border: 1px solid var(--line); }
    th, td { text-align: left; padding: 9px 12px; border-top: 1px solid var(--line); vertical-align: top; }
    th { font-weight: 500; color: var(--muted); border-top: 0; font-size: 12.5px; }
    td.mono { font: 12.5px ui-monospace, monospace; }
    .bar { display: flex; gap: 10px; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .bar h3 { margin: 0; font-size: 16px; font-weight: 550; }
  `;
  const LABEL = { open: "Due", pending: "Paying out", paid: "Paid", refunded: "Refunded", "past-due": "Past due", invalid: "Not valid" };
  const usdt = (base) => (Number(base) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = (s) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  /** Builds an element; strings become text nodes, so nothing from the API is parsed as HTML. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  async function load(params) {
    const r = await fetch(`${ORIGIN}/api/widget?${new URLSearchParams(params)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Couldn't load from Kin.");
    return j;
  }

  class GharElement extends HTMLElement {
    static observedAttributes = ["payee", "invoice"];
    connectedCallback() {
      this.root = this.root || this.attachShadow({ mode: "open" });
      this.seen = new Map();
      this.refresh();
      this.timer = setInterval(() => this.refresh(), POLL_MS);
    }
    disconnectedCallback() { clearInterval(this.timer); }
    attributeChangedCallback() { if (this.root) this.refresh(); }
    paint(...nodes) { this.root.replaceChildren(h("style", {}, CSS), ...nodes); }
    async refresh() {
      const payee = (this.getAttribute("payee") || "").trim();
      if (!payee) return this.paint(h("p", { class: "err" }, "Set the payee attribute to a Kin payee name."));
      try {
        const data = await load(this.params(payee));
        // Status changes become DOM events, so the merchant's page can react (mark an order paid, and so on).
        for (const b of data.bills) {
          if (this.seen.get(b.digest) !== b.status) {
            this.seen.set(b.digest, b.status);
            this.dispatchEvent(new CustomEvent("ghar:status", { bubbles: true, composed: true, detail: { view: this.localName, payee: data.payee.name, ...b } }));
          }
        }
        this.render(data);
      } catch (e) {
        this.paint(h("div", { class: "card" }, h("p", { class: "err" }, e.message)));
      }
    }
  }

  /** Customer view: one invoice, with a Pay with Kin button while it's due. */
  class GharInvoice extends GharElement {
    params(payee) { return { payee, invoice: this.getAttribute("invoice") || "" }; }
    render({ payee, bills }) {
      const ref = this.getAttribute("invoice") || "";
      const b = bills.find((x) => x.status === "open") || bills[0];
      if (!b) return this.paint(h("div", { class: "card" }, h("p", { class: "muted" }, `No bill ${ref} from ${payee.name} yet.`)));
      const action =
        b.status === "open" ? h("button", { onclick: () => window.open(b.payUrl, "_blank", "noopener") }, `Pay ${usdt(b.amount)} USDT with Kin`)
        : b.receipt ? h("a", { href: b.receipt.url, target: "_blank", rel: "noopener" }, `${b.status === "refunded" ? "Refund" : "Payment"} receipt →`)
        : h("p", { class: "muted" }, b.status === "pending" ? "Paid from the family's vault. The provider is paying it out." : LABEL[b.status]);
      this.paint(h("div", { class: "card" },
        h("div", { class: "top" }, h("div", { class: "amt" }, usdt(b.amount), h("small", {}, "USDT")), h("span", { class: `pill${b.status === "open" ? "" : " on"}` }, b.status === "open" ? `Due ${day(b.dueDate)}` : LABEL[b.status])),
        h("div", { class: "meta" }, `${b.invoiceRef} · ${payee.name} · ${b.currency}`),
        action,
        h("p", { class: "foot" }, "Paid in USDT on Whitechain to the account the provider verified for ", payee.name, "."),
      ));
    }
  }

  /** Merchant view: every bill with its status, totals, receipts and a CSV export for the accountant. */
  class GharMerchant extends GharElement {
    params(payee) { return { payee }; }
    render({ payee, bills }) {
      const total = (s) => usdt(bills.filter((b) => s.includes(b.status)).reduce((n, b) => n + Number(b.amount), 0));
      const raise = `${ORIGIN}/app/raise-bill?payee=${encodeURIComponent(payee.name)}`;
      this.paint(
        h("div", { class: "bar" },
          h("h3", {}, payee.name),
          h("div", { style: "display:flex;gap:8px" },
            h("button", { class: "ghost", onclick: () => this.csv(payee, bills) }, "Export CSV"),
            h("a", { class: "btn", href: raise, target: "_blank", rel: "noopener" }, "Raise a bill"))),
        h("div", { class: "sum" },
          h("div", {}, h("span", { class: "muted" }, "Received"), h("b", {}, total(["paid"]), " USDT")),
          h("div", {}, h("span", { class: "muted" }, "Paying out"), h("b", {}, total(["pending"]), " USDT")),
          h("div", {}, h("span", { class: "muted" }, "Open"), h("b", {}, total(["open"]), " USDT"))),
        bills.length === 0 ? h("p", { class: "muted" }, "No bills yet. Raise one from your billing wallet.") :
        h("table", {},
          h("thead", {}, h("tr", {}, ["Invoice", "Amount", "Due", "Status", "Receipt"].map((t) => h("th", {}, t)))),
          h("tbody", {}, bills.map((b) => h("tr", {},
            h("td", { class: "mono" }, b.invoiceRef),
            h("td", {}, `${usdt(b.amount)} USDT`),
            h("td", {}, day(b.dueDate)),
            h("td", {}, LABEL[b.status] || b.status, b.status === "refunded" && b.receipt ? h("div", { class: "muted" }, b.receipt.providerRef) : null),
            h("td", {}, b.receipt ? h("a", { href: b.receipt.url, target: "_blank", rel: "noopener" }, "Open →") : "—"),
          )))),
      );
    }
    csv(payee, bills) {
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = [["payee", "invoice", "amount_usdt", "local_currency", "due_date", "status", "settlement_tx", "provider_ref", "fiat_delivered", "receipt_url", "bill_digest"]];
      for (const b of bills) rows.push([payee.name, b.invoiceRef, usdt(b.amount).replace(/,/g, ""), b.currency, new Date(b.dueDate * 1000).toISOString().slice(0, 10), b.status,
        b.receipt?.settlementTx, b.receipt?.providerRef, b.receipt?.fiat, b.receipt?.url, b.digest]);
      const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" }));
      h("a", { href: url, download: `${payee.name}-bills.csv` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  if (!customElements.get("ghar-invoice")) customElements.define("ghar-invoice", GharInvoice);
  if (!customElements.get("ghar-merchant")) customElements.define("ghar-merchant", GharMerchant);
})();
