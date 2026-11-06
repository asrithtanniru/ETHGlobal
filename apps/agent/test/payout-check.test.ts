import { test } from "node:test";
import assert from "node:assert/strict";
import { namehash } from "viem/ens";
import { checkPayout } from "../src/payout-check.ts";

const biller = "0x14ce36ac40976c12b726AF5af5bfFFdAac14E0fd";
const other = "0x0000000000000000000000000000000000000001";
const name = "rent.gharfam.eth";
const node = namehash(name);
const bill = { payee: name };
const payee = { name, payoutRef: "demo:acct-rent-001", biller } as const;

test("passes when bill, ENS and vault agree", () => {
  assert.deepEqual(checkPayout(node, bill, payee, biller), { ok: true });
});

test("biller case does not matter", () => {
  assert.deepEqual(checkPayout(node, bill, payee, biller.toLowerCase() as typeof biller), { ok: true });
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
