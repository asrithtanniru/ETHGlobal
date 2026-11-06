import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zeroAddress, type Address } from "viem";
import { decide, PayoutStatus, runOnce, toVaultBill, noReview } from "../src/index.ts";
import type { AgentDeps, BillFacts, SignedBill, Vault } from "../src/index.ts";

const biller: Address = "0x14ce36ac40976c12b726AF5af5bfFFdAac14E0fd";
const other: Address = "0x0000000000000000000000000000000000009999";
const sender: Address = "0x0000000000000000000000000000000000000abc";
const NOW = 1_000;

const bill: SignedBill = {
  key: `0x${"11".repeat(32)}`,
  creator: biller,
  payee: "rent.gharfam.eth",
  invoiceRef: "inv-1",
  currency: "INR",
  amount: 100n,
  dueDate: 2_000,
  signature: "0x1234",
};

const facts: BillFacts = {
  payee: { name: "rent.gharfam.eth", payoutRef: "demo:acct-rent-001", biller },
  vaultBiller: biller,
  payoutStatus: PayoutStatus.None,
  balance: 500n,
  availableToAgent: 500n,
  availableToPayee: 500n,
};

describe("decide", () => {
  const cases: [string, Partial<SignedBill>, Partial<BillFacts>, string, string?][] = [
    ["pays a clean bill", {}, {}, "pay"],
    ["skips zero amount", { amount: 0n }, {}, "skip", "zero-amount"],
    ["skips past due", { dueDate: NOW - 1 }, {}, "skip", "expired"],
    ["skips a bill already in the vault", {}, { payoutStatus: PayoutStatus.Pending }, "skip", "already-handled"],
    ["skips a refunded bill", {}, { payoutStatus: PayoutStatus.Refunded }, "skip", "already-handled"],
    ["skips the wrong creator", { creator: other }, {}, "skip", "wrong-biller"],
    ["skips a mismatched payee", { payee: "clinic.gharfam.eth" }, {}, "skip", "payee-mismatch"],
    ["holds a payee the sender never added", {}, { vaultBiller: zeroAddress }, "hold", "payee-not-added"],
    ["holds when ENS and vault billers differ", {}, { vaultBiller: other }, "hold", "biller-changed"],
    ["holds on low balance", {}, { balance: 99n }, "hold", "low-balance"],
    ["holds over the agent grant", {}, { availableToAgent: 99n }, "hold", "over-agent-grant"],
    ["holds over the payee cap", {}, { availableToPayee: 99n }, "hold", "over-payee-cap"],
  ];
  for (const [name, b, f, action, reason] of cases) {
    it(name, () => {
      const d = decide({ ...bill, ...b }, { ...facts, ...f }, NOW);
      assert.equal(d.action, action);
      if (reason) assert.equal("reason" in d && d.reason, reason);
    });
  }
});

function harness(overrides: Partial<AgentDeps> = {}, vaultOverrides: Partial<Vault> = {}) {
  const calls = { pay: 0, simulate: 0 };
  const { payee: _payee, ...vaultFacts } = facts;
  const deps: AgentDeps = {
    sender,
    bills: { openBills: async () => [bill] },
    payees: { read: async () => facts.payee },
    vault: {
      readFacts: async () => vaultFacts,
      simulatePay: async () => void calls.simulate++,
      pay: async () => (calls.pay++, "0xabc"),
      ...vaultOverrides,
    },
    reviewer: noReview,
    dryRun: false,
    now: () => NOW,
    ...overrides,
  };
  return { deps, calls };
}

describe("runOnce", () => {
  it("simulates, then pays", async () => {
    const { deps, calls } = harness();
    const [o] = await runOnce(deps);
    assert.equal(o?.action, "paid");
    assert.deepEqual(calls, { pay: 1, simulate: 1 });
  });

  it("sends nothing on a dry run", async () => {
    const { deps, calls } = harness({ dryRun: true });
    assert.equal((await runOnce(deps))[0]?.action, "would-pay");
    assert.deepEqual(calls, { pay: 0, simulate: 1 });
  });

  it("does not pay when the reviewer holds", async () => {
    const { deps, calls } = harness({ reviewer: { review: async () => ({ hold: true, reason: "4x usual" }) } });
    const [o] = await runOnce(deps);
    assert.deepEqual([o?.action, o && "reason" in o && o.reason], ["hold", "4x usual"]);
    assert.equal(calls.pay, 0);
  });

  it("holds when the reviewer fails", async () => {
    const { deps, calls } = harness({ reviewer: { review: async () => { throw new Error("model down"); } } });
    const [o] = await runOnce(deps);
    assert.deepEqual([o?.action, o && "reason" in o && o.reason], ["hold", "review-failed"]);
    assert.equal(calls.pay, 0);
  });

  it("never consults the reviewer on a bill the rules refused", async () => {
    let reviewed = 0;
    const { deps, calls } = harness({
      bills: { openBills: async () => [{ ...bill, creator: other }] },
      reviewer: { review: async () => (reviewed++, { hold: false }) },
    });
    assert.equal((await runOnce(deps))[0]?.action, "skip");
    assert.equal(reviewed, 0);
    assert.equal(calls.pay, 0);
  });

  it("does not pay when simulation reverts, and carries on to the next bill", async () => {
    let n = 0;
    const { deps, calls } = harness(
      { bills: { openBills: async () => [bill, { ...bill, invoiceRef: "inv-2" }] } },
      { simulatePay: async () => { if (n++ === 0) throw new Error("vault-revert: InvalidSignature"); } },
    );
    const outcomes = await runOnce(deps);
    assert.deepEqual(outcomes.map((o) => o.action), ["error", "paid"]);
    assert.equal(calls.pay, 1);
  });

  it("does not pay when ENS records are missing", async () => {
    const { deps, calls } = harness({ payees: { read: async () => { throw new Error("missing payee records"); } } });
    assert.equal((await runOnce(deps))[0]?.action, "error");
    assert.equal(calls.pay, 0);
  });
});

describe("toVaultBill", () => {
  it("hashes the name and invoice ref", () => {
    const v = toVaultBill(bill);
    assert.match(v.payee, /^0x[0-9a-f]{64}$/);
    assert.match(v.invoiceRef, /^0x[0-9a-f]{64}$/);
    assert.equal(v.dueDate, 2_000n);
  });
});
