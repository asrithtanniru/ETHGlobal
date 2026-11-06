// Messages the wallet signs for the chat, and the types both sides of /api/chat share. No secrets here.
import { getAddress, type Address, type Hex } from "viem";

export const SESSION_DAYS = 7;

/** Proves wallet ownership to the chat API. It is bound to the site so another site can't reuse it. */
export const sessionMessage = (address: Address, site: string, expires: Date) =>
  `Sign in to Kin chat\n\nThis proves you own this wallet. It costs nothing and moves no funds.\n\nAddress: ${getAddress(address)}\nSite: ${site}\nExpires: ${expires.toISOString()}`;

/** The signed-in address, or undefined when the message is malformed, for another site, expired or too long-lived. */
export function parseSession(message: string, site: string, now = Date.now()): Address | undefined {
  const m = /\nAddress: (0x[0-9a-fA-F]{40})\nSite: ([^\n]+)\nExpires: ([^\n]+)$/.exec(message);
  if (!m || !message.startsWith("Sign in to Kin chat\n") || m[2] !== site) return undefined;
  const expires = Date.parse(m[3]!);
  if (!(expires > now) || expires > now + SESSION_DAYS * 86_400_000 + 60_000) return undefined;
  return getAddress(m[1]!);
}

/** What the sender signs to approve one bill. The vault's digest makes it single-use. */
export const payMessage = (digest: Hex, sender: Address) =>
  `Approve a Kin payment\n\nBill: ${digest}\nFrom the vault of: ${getAddress(sender)}\n\nThe vault still checks the biller's signature, your caps and your balance.`;

/** A bill the assistant found, as the app shows it. Amount is USDT base units as a string. */
export interface BillCard {
  digest: Hex;
  payee: string;
  invoiceRef: string;
  currency: string;
  amount: string;
  dueDate: number;
  payable: boolean;
  /** Reason code when not payable. */
  reason?: string;
  /** The AI reviewer's hold note. The sender can still approve. */
  aiNote?: string;
}

/**
 * A setup step the assistant prepared for the sender's own wallet to sign. Addresses come from ENS or
 * the server, never from the model. Amounts are USDT base units as strings, periods are seconds.
 */
export type ActionCard =
  | { kind: "deposit"; amount: string }
  | { kind: "add-payee"; name: string; biller: Address; payoutRef: string; perPayment: string; perPeriod: string; period: number }
  | { kind: "grant"; agent: Address; perPayment: string; perPeriod: string; period: number };

export interface Step { id: string; label: string; done: boolean }

/** One exchange as stored (encrypted) on Arkiv. */
export interface StoredTurn { user: string; assistant: string; steps: string[]; bills: BillCard[]; actions?: ActionCard[] }

/** Streamed from POST /api/chat, one JSON object per line. */
export type ChatEvent =
  | { t: "step"; id: string; label: string }
  | { t: "step-done"; id: string }
  | { t: "text"; d: string }
  | { t: "bills"; bills: BillCard[] }
  | { t: "actions"; actions: ActionCard[] }
  | { t: "end" }
  | { t: "saved"; key: Hex }
  | { t: "save-failed"; reason: string }
  | { t: "error"; message: string };

export const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_MESSAGE = 2000;

/** A positive USDT amount from a tool argument, as base units; undefined for anything else. */
export function usdtArg(v: unknown): bigint | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return undefined;
  return BigInt(Math.round(n * 1e6));
}

/** A whole number of days from 1 to 365, or undefined. */
export function daysArg(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 365 ? n : undefined;
}
