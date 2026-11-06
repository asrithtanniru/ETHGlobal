import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { and, asc, desc, eq, gte } from "@arkiv-network/sdk/query";
import { key as keyValue, str, u64 } from "@arkiv-network/sdk/schema";
import { http, type Address, type Hex } from "viem";
import type { ReceiptStatus } from "@ghar/shared";
import type { InboxBill } from "./bill.ts";
import { GharBill, GharChat, GharReceipt } from "./schema.ts";

/**
 * Read client. The access key stays server-side; it is part of the RPC URL, so never log the
 * transport or raw errors. An empty key uses the heavily rate-limited public endpoint.
 */
export function arkivClient(accessKey: string = process.env.ARKIV_ACCESS_KEY ?? "") {
  return createPublicClient({
    chain: rabdi({ accessKey }),
    cacheTime: 0,
    transport: http(undefined, { timeout: 8000, retryCount: 0, fetchOptions: { cache: "no-store" } }),
  });
}

export type ArkivReader = ReturnType<typeof arkivClient>;

export interface InboxReceipt {
  key: Hex;
  creator: Address;
  digest: Hex;
  billKey: Hex;
  payee: string;
  status: ReceiptStatus;
  settlementTx: Hex;
  providerRef: string;
  fiat?: string;
  payoutRef?: string;
  expiresAt: bigint;
}

const billFields = {
  $key: true, $creator: true, payee: true, invoiceRef: true, currency: true,
  dueDate: true, digest: true, amount: true, signature: true, note: true,
} as const;

const receiptFields = {
  $key: true, $creator: true, $expiresAt: true, digest: true, billKey: true, payee: true,
  status: true, settlementTx: true, providerRef: true, fiat: true, payoutRef: true,
} as const;

type Field<T> = { value: T };
type BillRow = {
  $key: Hex; $creator: Address; payee: Field<string>; invoiceRef: Field<string>; currency: Field<string>;
  dueDate: Field<bigint>; digest: Field<string>; amount: Field<bigint>; signature: Field<Hex>; note?: Field<string>;
};
type ReceiptRow = {
  $key: Hex; $creator: Address; $expiresAt: bigint; digest: Field<string>; billKey: Field<string>; payee: Field<string>;
  status: Field<string>; settlementTx: Field<string>; providerRef: Field<string>; fiat?: Field<string>; payoutRef?: Field<string>;
};

export function toBill(r: BillRow): InboxBill {
  return {
    key: r.$key,
    creator: r.$creator,
    payee: r.payee.value,
    invoiceRef: r.invoiceRef.value,
    currency: r.currency.value,
    dueDate: Number(r.dueDate.value),
    digest: r.digest.value as Hex,
    amount: r.amount.value,
    signature: r.signature.value,
    ...(r.note ? { note: r.note.value } : {}),
  };
}

export function toReceipt(r: ReceiptRow): InboxReceipt {
  return {
    key: r.$key,
    creator: r.$creator,
    digest: r.digest.value as Hex,
    billKey: r.billKey.value as Hex,
    payee: r.payee.value,
    status: r.status.value as ReceiptStatus,
    settlementTx: r.settlementTx.value as Hex,
    providerRef: r.providerRef.value,
    ...(r.fiat ? { fiat: r.fiat.value } : {}),
    ...(r.payoutRef ? { payoutRef: r.payoutRef.value } : {}),
    expiresAt: r.$expiresAt,
  };
}

/** The agent's query: bills for a payee from its ENS biller only, not yet past due. */
export async function openBills(client: ArkivReader, payee: string, biller: Address, nowSec = Math.floor(Date.now() / 1000)) {
  const page = await client
    .select(billFields)
    .from(GharBill)
    .createdBy(biller)
    .where(and(eq("payee", str(payee)), gte("dueDate", u64(nowSec))))
    .orderBy(desc("dueDate"))
    .limit(100)
    .fetch();
  return page.entities.map((r) => toBill(r as unknown as BillRow));
}

/** Everything posted under a payee name by anyone, so the app can show what was ignored and why. */
export async function billsForPayee(client: ArkivReader, payee: string) {
  const page = await client.select(billFields).from(GharBill).where(eq("payee", str(payee))).orderBy(desc("dueDate")).limit(100).fetch();
  return page.entities.map((r) => toBill(r as unknown as BillRow));
}

export async function billByDigest(client: ArkivReader, digest: Hex, biller?: Address) {
  const q = client.select(billFields).from(GharBill).where(eq("digest", str(digest))).limit(10);
  const page = await (biller ? q.createdBy(biller) : q).fetch();
  const row = page.entities[0];
  return row ? toBill(row as unknown as BillRow) : undefined;
}

/** Receipts count only from the provider wallet, read from the vault by the caller. */
export async function receiptForDigest(client: ArkivReader, digest: Hex, provider: Address) {
  const page = await client.select(receiptFields).from(GharReceipt).createdBy(provider).where(eq("digest", str(digest))).limit(1).fetch();
  const row = page.entities[0];
  return row ? toReceipt(row as unknown as ReceiptRow) : undefined;
}

export async function receiptsForPayee(client: ArkivReader, payee: string, provider: Address) {
  const page = await client.select(receiptFields).from(GharReceipt).createdBy(provider).where(eq("payee", str(payee))).limit(100).fetch();
  return page.entities.map((r) => toReceipt(r as unknown as ReceiptRow));
}

export async function receiptByKey(client: ArkivReader, key: Hex, provider: Address) {
  const page = await client.select(receiptFields).from(GharReceipt).createdBy(provider).where(eq("$key", keyValue(key))).limit(1).fetch();
  const row = page.entities[0];
  return row ? toReceipt(row as unknown as ReceiptRow) : undefined;
}

export interface ChatTurnRow {
  key: Hex;
  thread: string;
  seq: number;
  at: number;
  body: Hex;
}

const chatFields = { $key: true, thread: true, seq: true, at: true, body: true } as const;
type ChatRow = { $key: Hex; thread: Field<string>; seq: Field<bigint>; at: Field<bigint>; body: Field<Hex> };
const toTurn = (r: ChatRow): ChatTurnRow => ({ key: r.$key, thread: r.thread.value, seq: Number(r.seq.value), at: Number(r.at.value), body: r.body.value });

/** First turn of every thread an owner has, newest first. Only the chat writer's entities count. */
export async function chatThreads(client: ArkivReader, owner: Address, writer: Address) {
  const page = await client.select(chatFields).from(GharChat).createdBy(writer)
    .where(and(eq("owner", str(owner.toLowerCase())), eq("seq", u64(0)))).orderBy(desc("at")).limit(100).fetch();
  return page.entities.map((r) => toTurn(r as unknown as ChatRow));
}

/** Every turn of one thread, oldest first. */
// shortcut: one page of 100 turns (the SDK's MAX_LIMIT); page with the cursor once threads get that long.
export async function chatTurns(client: ArkivReader, owner: Address, thread: string, writer: Address) {
  const page = await client.select(chatFields).from(GharChat).createdBy(writer)
    .where(and(eq("owner", str(owner.toLowerCase())), eq("thread", str(thread)))).orderBy(asc("at")).limit(100).fetch();
  return page.entities.map((r) => toTurn(r as unknown as ChatRow));
}
