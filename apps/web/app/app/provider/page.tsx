"use client";

import { PageHead } from "@/components/app/AppShell";
import { Payouts } from "@/components/app/Payouts";

// shortcut: open to anyone for the staging demo; in production only the provider's own team runs payouts.
export default function ProviderPayouts() {
  return (
    <div className="page">
      <PageHead title="Pay out bills">
        For the payout provider. Each bill a vault paid is locked for you on Whitechain. Pay the payee in local currency, and the vault
        releases the USDT to you. On Transak staging the payee confirms each payout with the test card ••1519.
      </PageHead>
      <div className="stack">
        <Payouts filter={{}} title="To pay out" provider only="pending" empty="Nothing to pay out. A row appears here when the agent pays a bill from a vault." />
        <Payouts filter={{}} title="Paid out" provider only="settled" empty="No payouts settled yet." />
      </div>
    </div>
  );
}
