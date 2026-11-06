/** Dynamic payee names: `{tag}.{family}.eth` built from username + spend tag. */
import { normalize } from "viem/ens";
import { PAYEE_BOOK_PARENT } from "@ghar/shared";

// `agent` is the AI-agent identity (ENSIP-26), never a user payee tag.
export const RESERVED_TAGS = ["agent"] as const;

const MAX_LABEL = 63;

/** The family an agent or script works for: PAYEE_FAMILY, else the demo family. */
export const payeeFamily = () => process.env.PAYEE_FAMILY || PAYEE_BOOK_PARENT;

/** Lowercase, hyphenate, strip illegal chars, collapse repeats, cap at 63. */
export function slugifyCategory(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LABEL);
  if (!slug) throw new Error(`empty category: ${JSON.stringify(input)}`);
  if ((RESERVED_TAGS as readonly string[]).includes(slug)) {
    throw new Error(`reserved tag: ${slug}`);
  }
  return slug;
}

function normalizeFamily(family: string): string {
  const f = family.toLowerCase().trim();
  if (!f.endsWith(".eth")) throw new Error(`family must end in .eth: ${family}`);
  if (f.split(".").length !== 2) throw new Error(`family must be one label + .eth: ${family}`);
  return f;
}

/** "ram.eth" + "School Fees" -> "school-fees.ram.eth". Rejects reserved tags. */
export function buildPayeeName(family: string, tag: string): string {
  // Docs (app-developers guide): always normalize user input first (viem/ens, ENSIP-15).
  return normalize(`${slugifyCategory(tag)}.${normalizeFamily(family)}`);
}

/** "rent.ram.eth" -> { family: "ram.eth", tag: "rent" }. Rejects bad shapes. */
export function parsePayeeName(name: string): { family: string; tag: string } {
  const n = normalize(name);
  const parts = n.split(".");
  if (parts.length !== 3 || parts[2] !== "eth" || !parts[0] || !parts[1]) {
    throw new Error(`not a payee name (want tag.family.eth): ${name}`);
  }
  return { tag: parts[0] as string, family: `${parts[1]}.eth` };
}

/** Expired or revoked names stop payments; `nowSec` defaults to Date.now(). */
export function isExpired(expiry: number, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  return expiry <= nowSec;
}
// slugifyCategory stays Ghar-specific (category -> label); ENSIP-15 validity comes from normalize above.
