import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GHAR_VAULT, gharVaultAbi, settlementChain } from "@ghar/shared";
import { billDigest, billTypedData, checkBill, toVaultBill, type InboxBill } from "../src/bill.ts";

// Throwaway keys, used only to sign in this test.
const biller = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const scammer = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594f1c0e7b1b6a9e4a");
const now = 1_800_000_000;
const input = { payee: "rent.gharfam.eth", invoiceRef: "INV-0412", amount: 120_000_000n, dueDate: now + 86_400 };
const state = { name: "rent.gharfam.eth", payoutRef: "demo:acct-rent-001", biller: biller.address };

async function bill(over: Partial<InboxBill> = {}, signer = biller): Promise<InboxBill> {
  const signature = await signer.signTypedData(billTypedData(input));
  return { ...input, key: `0x${"ab".repeat(32)}`, creator: biller.address, currency: "USD", digest: billDigest(input), signature, ...over };
}

test("a bill signed by the ENS biller passes", async () => {
  assert.deepEqual(await checkBill(await bill(), state, now), { ok: true });
});

test("the flowchart's scammer: posted from another wallet", async () => {
  const fake = await bill({ creator: scammer.address }, scammer);
  assert.deepEqual(await checkBill(fake, state, now), { ok: false, reason: "wrong-biller" });
});

test("a copied entity with a changed amount fails the digest", async () => {
  assert.deepEqual(await checkBill(await bill({ amount: 999_000_000n }), state, now), { ok: false, reason: "digest-mismatch" });
});

test("a right creator with someone else's signature fails", async () => {
  assert.deepEqual(await checkBill(await bill({}, scammer), state, now), { ok: false, reason: "wrong-signature" });
});

test("past-due bills are refused like the vault refuses them", async () => {
  assert.deepEqual(await checkBill(await bill(), state, input.dueDate + 1), { ok: false, reason: "past-due" });
});

// Read-only eth_call: proves the off-chain digest is exactly what the deployed vault computes.
test("digest matches GharVault.billDigest on Whitechain", { skip: process.env.OFFLINE === "1" }, async () => {
  const client = createPublicClient({ chain: settlementChain, transport: http("https://rpc.testnet.whitechain.io") });
  const onchain = await client.readContract({ address: GHAR_VAULT, abi: gharVaultAbi, functionName: "billDigest", args: [toVaultBill(input)] });
  assert.equal(onchain, billDigest(input));
});
