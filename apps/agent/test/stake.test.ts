import { test } from "node:test";
import assert from "node:assert/strict";
import { stakeAction, type StakeView } from "../src/stake.ts";

const view: StakeView = { delay: 100n, keep: 10n, balance: 50n, staked: 0n, lastActive: 1000n };

test("does nothing without the sender's agreement", () => {
  assert.equal(stakeAction({ ...view, delay: 0n }, 5000n), undefined);
  assert.equal(stakeAction({ ...view, delay: 0n, staked: 40n }, 5000n), undefined);
});

test("waits for the full delay", () => {
  assert.equal(stakeAction(view, 1099n), undefined);
  assert.equal(stakeAction(view, 1100n), "stake");
});

test("leaves the kept amount alone", () => {
  assert.equal(stakeAction({ ...view, balance: 10n }, 5000n), undefined);
});

test("brings the stake back once the sender is active again", () => {
  assert.equal(stakeAction({ ...view, staked: 40n }, 1050n), "unstake");
});

test("stays staked while the sender is quiet", () => {
  assert.equal(stakeAction({ ...view, balance: 10n, staked: 40n }, 5000n), undefined);
});
