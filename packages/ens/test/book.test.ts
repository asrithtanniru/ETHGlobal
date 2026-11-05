import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPayeeName, parsePayeeName, isExpired } from "../src/names.js";
import { isBillPayable } from "../src/guard.js";

describe("dynamic payee names", () => {
  it("builds tag.family.eth from username + category", () => {
    assert.equal(buildPayeeName("ram.eth", "rent"), "rent.ram.eth");
    assert.equal(buildPayeeName("ram.eth", "School Fees"), "school-fees.ram.eth");
    assert.equal(buildPayeeName("priya.eth", "clinic"), "clinic.priya.eth");
  });

  it("rejects reserved agent tag and bad family", () => {
    assert.throws(() => buildPayeeName("ram.eth", "agent"), /reserved/);
    assert.throws(() => buildPayeeName("ram.com", "rent"), /\.eth/);
  });

  it("round-trips parse and flags expiry", () => {
    assert.deepEqual(parsePayeeName("rent.ram.eth"), { tag: "rent", family: "ram.eth" });
    assert.equal(buildPayeeName("RAM.eth", "Rent"), "rent.ram.eth");
    assert.throws(() => parsePayeeName("ram.eth"), /payee name/);
    assert.throws(() => parsePayeeName("rent..eth"), /./);
    assert.equal(isExpired(1_000, 2_000), true);
    assert.equal(isExpired(2_000, 1_000), false);
  });
});

describe("bill guard", () => {
  const state = { name: "rent.ram.eth", payoutRef: "prov:1", biller: "0xB1ller000000000000000000000000000000000001" as const };
  it("accepts matching bill, rejects wrong biller and expired", () => {
    assert.deepEqual(isBillPayable({ payee: "rent.ram.eth", creator: state.biller }, state), { ok: true });
    assert.deepEqual(isBillPayable({ payee: "rent.ram.eth", creator: "0x0000000000000000000000000000000000009999" }, state).ok, false);
    assert.deepEqual(isBillPayable({ payee: "rent.ram.eth", creator: state.biller }, { ...state, expiry: 1_000 }, 2_000).ok, false);
  });
});
