// Pay with Direct, shared by the browser and the server: what a send looks like and the rules for one.
import { parseUnits, type Hex } from "viem";

/** INR pays out to a UPI ID through P2P.me; the rest through Transak. */
export const CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const;
export type Currency = (typeof CURRENCIES)[number];
/** 1 to 1,000 USDT per send; the sender's own Direct cap in the vault can be lower. */
export const MIN_SEND = 1_000_000n;
export const MAX_SEND = 1_000_000_000n;
/** A claim link is good for less than the vault's 1-day reclaim window. */
export const CLAIM_HOURS = 20;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export function parseSend(body: unknown): { amount: bigint; currency: Currency; email: string } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = typeof b.amount === "string" ? b.amount.trim() : "";
  if (!/^\d{1,7}(\.\d{1,6})?$/.test(raw)) return { error: "Enter an amount in USDT, like 25 or 12.50." };
  const amount = parseUnits(raw, 6);
  if (amount < MIN_SEND || amount > MAX_SEND) return { error: "Send between 1 and 1,000 USDT." };
  if (!CURRENCIES.includes(b.currency as Currency)) return { error: "Choose USD, EUR, GBP or INR." };
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return { error: "Enter your friend's email. Only they can claim the money with it." };
  return { amount, currency: b.currency as Currency, email };
}

/** r•••@example.com, so a list never shows a whole address. */
export const maskEmail = (email: string) => {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}•••@${domain}`;
};

/** One of the sender's sends, as the Pay with Direct page lists it. */
export type SendRow = {
  digest: Hex;
  amountUsdt: string;
  currency: Currency;
  email: string;
  at: number;
  status: "unpaid" | "pending" | "paid" | "refunded";
  link?: string;
  receiptKey?: Hex;
};

/** What the claim page shows. */
export type ClaimView = {
  amountUsdt: string;
  currency: Currency;
  from: string;
  email: string;
  expired: boolean;
  status: "unpaid" | "pending" | "paid" | "refunded";
  stage?: string;
  orderStatus?: string;
  lockTx?: Hex;
  depositTx?: Hex;
  settleTx?: Hex;
  receiptKey?: Hex;
  fiat?: string;
  providerRef?: string;
};
