import { namehash } from "viem/ens";
import type { Hex } from "viem";
import { PAYEE_BOOK_PARENT } from "@ghar/shared";
import { buildPayeeName } from "@ghar/ens";

// The vault stores payees as namehashes, which can't be reversed. Names are recovered from common
// bill tags plus every name this browser has looked up.
// shortcut: per-browser memory only; upgrade to an ENS subname listing once the payee book has one.
export const COMMON = ["rent", "school-fees", "clinic", "electricity", "water", "internet", "phone", "groceries"];
const KEY = "ghar.names";

function stored(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

export function rememberName(node: Hex, name: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...stored(), [node]: name })); } catch { /* storage blocked */ }
}

export function nameFor(node: Hex): string | undefined {
  const hit = stored()[node];
  if (hit) return hit;
  for (const t of COMMON) {
    const n = buildPayeeName(PAYEE_BOOK_PARENT, t);
    if (namehash(n) === node) return n;
  }
  return undefined;
}


/** Every payee name this browser has looked up, for the chat to recover names from namehashes. */
export const knownNames = () => Object.values(stored());
