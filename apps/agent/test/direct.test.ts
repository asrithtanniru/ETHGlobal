import { test } from "node:test";
import assert from "node:assert/strict";
import { nextP2pStep, nextStep, orderIdFor, viaP2p, type DepositEntry } from "../src/direct.ts";

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

const o = (status: "placed" | "accepted" | "paid" | "completed" | "cancelled", disputeStatus: "none" | "open" | "resolved" = "none") => ({ status, disputeStatus });

test("only INR goes through P2P.me; USD, EUR and GBP stay on Transak", () => {
  assert.equal(viaP2p({ currency: "INR" }), true);
  for (const currency of ["USD", "EUR", "GBP"]) assert.equal(viaP2p({ currency }), false);
  assert.equal(viaP2p(undefined), false);
});

test("P2P.me: the UPI ID goes to the merchant once, only after they accept", () => {
  assert.equal(nextP2pStep(o("placed"), []).kind, "awaiting-merchant");
  assert.equal(nextP2pStep(o("accepted"), []).kind, "deliver");
  assert.equal(nextP2pStep(o("accepted"), [{ orderId: "o", phase: "upi-intent" }]).kind, "upi-uncertain");
  assert.equal(nextP2pStep(o("accepted"), [{ orderId: "o", phase: "upi-intent" }, { orderId: "o", phase: "upi-sent" }]).kind, "upi-sent");
  assert.equal(nextP2pStep(o("paid"), []).kind, "merchant-paying");
});

test("P2P.me: completed pays, cancelled refunds, an open dispute holds", () => {
  assert.deepEqual(nextP2pStep(o("completed"), []), { kind: "paid" });
  assert.deepEqual(nextP2pStep(o("cancelled"), []), { kind: "refund", reason: "P2P.me order cancelled" });
  assert.equal(nextP2pStep(o("paid", "open"), []).kind, "disputed");
  assert.deepEqual(nextP2pStep(o("completed", "resolved"), []), { kind: "paid" });
});
