import { test } from "node:test";
import assert from "node:assert/strict";
import { ContractFunctionRevertedError, encodeErrorResult, parseAbi } from "viem";
import { namehash } from "viem/ens";
import { getVerifiedPayee } from "@ghar/ens";
import { checkPayout, isMissingPayee } from "../src/payout-check.ts";

const biller = "0x14ce36ac40976c12b726AF5af5bfFFdAac14E0fd";
const other = "0x0000000000000000000000000000000000000001";
const name = "rent.gharfam.eth";
const node = namehash(name);
const bill = { payee: name };
const payee = { name, payoutRef: "demo:acct-rent-001", biller } as const;

test("passes when bill, ENS and vault agree", () => {
  assert.deepEqual(checkPayout(node, bill, payee, biller), { ok: true, payoutRef: payee.payoutRef });
});

test("biller case does not matter", () => {
  assert.deepEqual(checkPayout(node, bill, payee, biller.toLowerCase() as typeof biller), { ok: true, payoutRef: payee.payoutRef });
});

test("refuses without an Arkiv bill from the accepted biller", () => {
  assert.deepEqual(checkPayout(node, undefined, payee, biller), { ok: false, reason: "no-arkiv-bill" });
});

test("refuses a bill naming a different payee", () => {
  assert.deepEqual(checkPayout(node, { payee: "clinic.gharfam.eth" }, payee, biller), { ok: false, reason: "payee-mismatch" });
});

test("refuses when ENS records are gone", () => {
  assert.deepEqual(checkPayout(node, bill, undefined, biller), { ok: false, reason: "missing-ens-records" });
});

test("refuses when the ENS biller changed after the sender added the payee", () => {
  assert.deepEqual(checkPayout(node, bill, payee, other), { ok: false, reason: "biller-changed" });
});

const abi = parseAbi(["error ResolverNotFound(bytes name)", "error ResolverError(bytes errorData)", "error HttpError(uint16 status, string message)"]);
const reverted = (data: `0x${string}`) => new ContractFunctionRevertedError({ abi, functionName: "resolveWithGateways", data });

test("a name with no resolver or no records counts as missing", () => {
  assert.equal(isMissingPayee(reverted(encodeErrorResult({ abi, errorName: "ResolverNotFound", args: ["0x"] }))), true);
  assert.equal(isMissingPayee(new Error(`missing payee records: ${name}`)), true);
});

test("a failure to answer is not a missing payee, so the payout is retried", () => {
  assert.equal(isMissingPayee(reverted(encodeErrorResult({ abi, errorName: "HttpError", args: [503, "down"] }))), false);
  assert.equal(isMissingPayee(reverted(encodeErrorResult({ abi, errorName: "ResolverError", args: ["0x"] }))), false);
  assert.equal(isMissingPayee(new Error("fetch failed")), false);
});

test("strict reads reach the ENS client", async () => {
  const seen: unknown[] = [];
  const client = { getEnsText: async (a: { strict?: boolean }) => (seen.push(a.strict), biller) };
  await getVerifiedPayee(client as never, name, { strict: true });
  await getVerifiedPayee(client as never, name);
  assert.deepEqual(seen, [true, true, false, false]);
});
