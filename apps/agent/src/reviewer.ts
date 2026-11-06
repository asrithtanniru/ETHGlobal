import { formatUnits, type PublicClient, type Transport, type Address } from "viem";
import { namehash } from "viem/ens";
import { GHAR_VAULT, GHAR_VAULT_DEPLOY_BLOCK, gharVaultAbi, USDT, type settlementChain } from "@ghar/shared";
import type { InboxBill } from "@ghar/arkiv";
import { chatJson, type ChatRequest, type LlmEndpoint } from "./llm.ts";

export type Verdict = { hold: false } | { hold: true; reason: string };

/** Second opinion on a bill the rules already passed. It can only hold, never approve. */
export interface Reviewer {
  review(bill: InboxBill): Promise<Verdict>;
}

/** Used when no LLM keys are set. */
export const noReview: Reviewer = { review: async () => ({ hold: false }) };

export const REVIEW_FAILED = "review-failed";

/** A failed review holds the bill: no opinion is never treated as approval. */
export function reviewBill(reviewer: Reviewer, bill: InboxBill): Promise<Verdict> {
  return reviewer.review(bill).catch(() => ({ hold: true, reason: REVIEW_FAILED }));
}

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

function parseVerdict(value: unknown): Verdict {
  const { hold, reason } = (value ?? {}) as { hold?: unknown; reason?: unknown };
  if (typeof hold !== "boolean" || typeof reason !== "string") throw new Error("bad verdict shape");
  return hold ? { hold: true, reason: reason.slice(0, 200) || "unusual bill" } : { hold: false };
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
    async review(bill) {
      const nowSec = now?.() ?? Math.floor(Date.now() / 1000);
      const request: ChatRequest = {
        system: SYSTEM,
        schemaName: "bill_review",
        schema: SCHEMA,
        user: JSON.stringify({
          payee: bill.payee,
          amountUsdt: usdt(bill.amount),
          daysUntilDue: Math.floor((bill.dueDate - nowSec) / 86_400),
          pastAmountsUsdt: (await pastAmounts(bill.payee)).map(usdt),
        }),
      };
      return chatJson(endpoints, request, parseVerdict, fetchFn);
    },
  };
}

/** The Whitechain RPC caps log queries at this many blocks. */
const LOG_RANGE = 10_000n;

/** Amounts this sender has sent to a payee, oldest first. */
export function vaultPastAmounts(client: PublicClient<Transport, typeof settlementChain>, sender: Address) {
  return async (payee: string): Promise<bigint[]> => {
    const head = await client.getBlockNumber();
    const amounts: bigint[] = [];
    for (let from = GHAR_VAULT_DEPLOY_BLOCK; from <= head; from += LOG_RANGE) {
      const to = from + LOG_RANGE - 1n < head ? from + LOG_RANGE - 1n : head;
      const logs = await client.getContractEvents({
        address: GHAR_VAULT,
        abi: gharVaultAbi,
        eventName: "PayoutRequested",
        args: { sender, payee: namehash(payee) },
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) if (log.args.amount !== undefined) amounts.push(log.args.amount);
    }
    return amounts;
  };
}
