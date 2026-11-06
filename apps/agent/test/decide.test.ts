import { test } from "node:test";
import assert from "node:assert/strict";
import type { InboxBill } from "@ghar/arkiv";
import { decide, type VaultView } from "../src/decide.ts";

const biller = "0x14ce36ac40976c12b726AF5af5bfFFdAac14E0fd";
const bill = { amount: 100n } as InboxBill;
const vault: VaultView = { biller, balance: 500n, availableToPayee: 200n, availableToAgent: 300n };

test("pays when every check and limit allows", () => {
  assert.deepEqual(decide(bill, { ok: true }, biller, vault), { pay: true });
});

test("a failed bill check holds the payment", () => {
  assert.deepEqual(decide(bill, { ok: false, reason: "wrong-biller" }, biller, vault), { pay: false, reason: "wrong-biller" });
});

test("ENS and the vault must agree on the biller", () => {
  const other = { ...vault, biller: "0x0000000000000000000000000000000000000001" as const };
  assert.deepEqual(decide(bill, { ok: true }, biller, other), { pay: false, reason: "vault-biller-differs-from-ens" });
});

test("a payee the sender never added is reported as not in the vault", () => {
  const none = { ...vault, biller: "0x0000000000000000000000000000000000000000" as const };
  assert.deepEqual(decide(bill, { ok: true }, biller, none), { pay: false, reason: "not-in-vault" });
});

test("limits are checked before spending gas", () => {
  assert.equal((decide(bill, { ok: true }, biller, { ...vault, availableToAgent: 99n }) as { reason: string }).reason, "over-agent-grant");
  assert.equal((decide(bill, { ok: true }, biller, { ...vault, availableToPayee: 99n }) as { reason: string }).reason, "over-payee-cap");
  assert.equal((decide(bill, { ok: true }, biller, { ...vault, balance: 99n }) as { reason: string }).reason, "balance-too-low");
});
