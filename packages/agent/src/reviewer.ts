import { formatUnits } from "viem";
import { USDT } from "@ghar/shared";
import { chatJson, type ChatRequest, type LlmEndpoint } from "./llm.ts";
import type { Reviewer } from "./types.ts";

const SYSTEM = `You review one household bill before an automated payment. The signature, payee, caps and balance already passed separate checks, so do not comment on them.
Decide whether the sender should look at this bill first.
Set hold to true only if the amount is clearly unusual against this payee's past amounts, for example several times larger, or it repeats a recent amount suspiciously soon.
No past amounts means no baseline: set hold to false.
Set reason to one short plain sentence for the sender. Use an empty string when hold is false.`;

const SCHEMA = {
  type: "object",
  properties: { hold: { type: "boolean" }, reason: { type: "string" } },
  required: ["hold", "reason"],
  additionalProperties: false,
};

function parseVerdict(value: unknown) {
  const { hold, reason } = (value ?? {}) as { hold?: unknown; reason?: unknown };
  if (typeof hold !== "boolean" || typeof reason !== "string") throw new Error("bad verdict shape");
  return hold ? ({ hold: true, reason: reason.slice(0, 200) || "unusual bill" } as const) : ({ hold: false } as const);
}

const usdt = (amount: bigint) => formatUnits(amount, USDT.decimals);

export interface ReviewerOptions {
  endpoints: LlmEndpoint[];
  /** Past amounts paid to this payee, oldest first. */
  pastAmounts: (payee: string) => Promise<bigint[]>;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/**
 * AI second opinion. The model sees only numbers and the ENS name: `note` and `invoiceRef`
 * are written by the payee, so they stay out of the prompt. It has no tools and no keys.
 */
export function llmReviewer({ endpoints, pastAmounts, fetchFn, now }: ReviewerOptions): Reviewer {
  return {
    async review(bill, payee) {
      const nowSec = now?.() ?? Math.floor(Date.now() / 1000);
      const request: ChatRequest = {
        system: SYSTEM,
        schemaName: "bill_review",
        schema: SCHEMA,
        user: JSON.stringify({
          payee: payee.name,
          amountUsdt: usdt(bill.amount),
          daysUntilDue: Math.floor((bill.dueDate - nowSec) / 86_400),
          pastAmountsUsdt: (await pastAmounts(payee.name)).map(usdt),
        }),
      };
      return chatJson(endpoints, request, parseVerdict, fetchFn);
    },
  };
}
