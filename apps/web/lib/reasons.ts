/** Plain sentences for the reason codes checkBill, decide and the chat return. */
export const REASONS: Record<string, string> = {
  "wrong-biller": "Posted by a wallet that isn't this payee's biller",
  "wrong-signature": "Signed by the wrong wallet",
  "bad-signature": "The signature can't be read",
  "digest-mismatch": "The amount or date doesn't match what was signed",
  "past-due": "Past its due date",
  "payee-mismatch": "Posted for a different payee",
  revoked: "This payee was revoked",
  expired: "This payee's name expired",
  "vault-biller-differs-from-ens": "The biller in your vault no longer matches ENS. Re-add the payee",
  "over-agent-grant": "Over what the chat agent's grant allows right now",
  "over-payee-cap": "Over this payee's cap for the period",
  "balance-too-low": "Your vault balance is too low",
  "already-paid": "Already paid",
  "not-in-vault": "This payee isn't in your vault yet",
  checking: "Checking your vault",
  invalid: "It isn't signed by the payee's verified biller",
};
export const reason = (code: string) => REASONS[code] ?? code;
