import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStep, orderIdFor, type DepositEntry } from "../src/direct.ts";

const to = "0x1111111111111111111111111111111111111111";
const awaiting = { id: "o1", status: "AWAITING_PAYMENT_FROM_USER", cryptoAmount: 0.02, cryptoPaymentData: { paymentAddress: to } };

test("sends the deposit only when Transak asks for it, to a real address, for the agreed amount", () => {
  assert.deepEqual(nextStep(awaiting, [], "0.02"), { kind: "send", to });
  assert.equal(nextStep({ ...awaiting, cryptoAmount: 0.5 }, [], "0.02").kind, "amount-mismatch");
  assert.equal(nextStep({ ...awaiting, cryptoPaymentData: { paymentAddress: "not-an-address" } }, [], "0.02").kind, "processing");
  assert.equal(nextStep({ ...awaiting, status: "PROCESSING" }, [], "0.02").kind, "processing");
});

test("never sends a deposit twice, even after a crash between intent and send", () => {
  const sent: DepositEntry[] = [{ orderId: "o", phase: "intent", to }, { orderId: "o", phase: "sent", hash: `0x${"ab".repeat(32)}`, to }];
  assert.deepEqual(nextStep(awaiting, sent, "0.02"), { kind: "deposit-sent", depositTx: `0x${"ab".repeat(32)}` });
  assert.equal(nextStep(awaiting, [{ orderId: "o", phase: "intent", to }], "0.02").kind, "deposit-uncertain");
});

test("a finished order settles: completed pays, failed or expired refunds", () => {
  assert.deepEqual(nextStep({ id: "o", status: "COMPLETED" }, [], "0.02"), { kind: "paid" });
  assert.deepEqual(nextStep({ id: "o", status: "EXPIRED" }, [], "0.02"), { kind: "refund", reason: "Transak order EXPIRED" });
});

test("one fixed order id per payout", () => {
  assert.equal(orderIdFor(`0x${"cd".repeat(32)}`), `ghar-${"cd".repeat(8)}`);
});
