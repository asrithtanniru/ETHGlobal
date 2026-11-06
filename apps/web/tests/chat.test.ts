import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { daysArg, parseSession, payMessage, sessionMessage, usdtArg } from "../lib/chatSign.ts";
import { seal, unseal } from "../lib/chatCrypto.ts";
import { blocksOf } from "../lib/rich.ts";

// Throwaway key, used only to sign in this test.
const me = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const now = Date.parse("2026-11-06T12:00:00Z");
const inDays = (d: number) => new Date(now + d * 86_400_000);

test("a session is accepted only for this site, unexpired and at most a week long", () => {
  assert.equal(parseSession(sessionMessage(me.address, "ghar.app", inDays(7)), "ghar.app", now), me.address);
  assert.equal(parseSession(sessionMessage(me.address, "evil.site", inDays(1)), "ghar.app", now), undefined);
  assert.equal(parseSession(sessionMessage(me.address, "ghar.app", inDays(-1)), "ghar.app", now), undefined);
  assert.equal(parseSession(sessionMessage(me.address, "ghar.app", inDays(30)), "ghar.app", now), undefined);
  assert.equal(parseSession(`hello\nAddress: ${me.address}\nSite: ghar.app\nExpires: ${inDays(1).toISOString()}`, "ghar.app", now), undefined);
});

test("a payment approval is bound to one digest and one sender", async () => {
  const digest = `0x${"ab".repeat(32)}` as const;
  const signature = await me.signMessage({ message: payMessage(digest, me.address) });
  assert.equal(await verifyMessage({ address: me.address, message: payMessage(digest, me.address), signature }), true);
  assert.equal(await verifyMessage({ address: me.address, message: payMessage(`0x${"cd".repeat(32)}`, me.address), signature }), false);
});

test("sealed chat turns open only for their owner and fail when altered", () => {
  const secret = "s".repeat(32);
  const turn = { user: "pay my school fees", assistant: "Here is the bill.", steps: [], bills: [] };
  const body = seal(secret, me.address, turn);
  assert.deepEqual(unseal(secret, me.address.toLowerCase(), body), turn);
  assert.throws(() => unseal(secret, "0x0000000000000000000000000000000000000001", body));
  assert.throws(() => unseal(secret, me.address, `${body.slice(0, -2)}${body.endsWith("00") ? "01" : "00"}` as `0x${string}`));
  assert.throws(() => seal("short", me.address, turn));
});

test("model text splits into paragraphs and lists, including a list right after an intro line", () => {
  assert.deepEqual(blocksOf("To start:\n- Add a payee\n- Deposit\n\nThen ask again.\nThanks"), [
    { list: false, lines: ["To start:"] },
    { list: true, lines: ["- Add a payee", "- Deposit"] },
    { list: false, lines: ["Then ask again.", "Thanks"] },
  ]);
});

test("tool arguments for setup cards accept only sane amounts and periods", () => {
  assert.equal(usdtArg(12.5), 12_500_000n);
  assert.equal(usdtArg("20"), 20_000_000n);
  assert.equal(usdtArg(0.000001), 1n);
  for (const bad of [0, -5, "abc", "", null, undefined, Infinity, 2_000_000, "1e9"]) assert.equal(usdtArg(bad), undefined, String(bad));
  assert.equal(daysArg(30), 30);
  assert.equal(daysArg("7"), 7);
  for (const bad of [0, 1.5, 400, "x", null]) assert.equal(daysArg(bad), undefined, String(bad));
});

test("a gasless deposit signature is checked against the vault as recipient and the relay rules", async () => {
  const { depositTypedData, parseDepositAuth } = await import("../lib/eip3009.ts");
  const { verifyTypedData } = await import("viem");
  const nowSec = 1_800_000_000;
  const nonce = `0x${"11".repeat(32)}` as const;
  const typed = depositTypedData(me.address, 5_000_000n, BigInt(nowSec + 1800), nonce);
  const signature = await me.signTypedData(typed);
  const body = { from: me.address, value: "5000000", validBefore: String(nowSec + 1800), nonce, signature };
  const auth = parseDepositAuth(body, nowSec);
  assert.ok(!("error" in auth));
  assert.equal(await verifyTypedData({ address: me.address, ...typed, signature }), true);
  // The relayer rebuilds the typed data, so a changed amount no longer matches the signature.
  assert.equal(await verifyTypedData({ address: me.address, ...depositTypedData(me.address, 50_000_000n, BigInt(nowSec + 1800), nonce), signature }), false);
  assert.match((parseDepositAuth({ ...body, value: "999999" }, nowSec) as { error: string }).error, /1 USDT/);
  assert.match((parseDepositAuth({ ...body, validBefore: String(nowSec + 30) }, nowSec) as { error: string }).error, /expired/);
  assert.match((parseDepositAuth({ ...body, validBefore: String(nowSec + 86_400) }, nowSec) as { error: string }).error, /too long/);
  assert.match((parseDepositAuth({ ...body, signature: "0x12" }, nowSec) as { error: string }).error, /signature/);
});

test("a Direct send needs a sane amount, a supported currency and the friend's email", async () => {
  const { maskEmail, parseSend } = await import("../lib/directShared.ts");
  assert.deepEqual(parseSend({ amount: "12.5", currency: "GBP", email: " Friend@Example.com " }), { amount: 12_500_000n, currency: "GBP", email: "friend@example.com" });
  for (const amount of ["0", "0.5", "1000.000001", "abc", "", "1e3", "-5"]) assert.ok("error" in parseSend({ amount, currency: "USD", email: "a@b.co" }), amount);
  assert.ok("error" in parseSend({ amount: "5", currency: "INR", email: "a@b.co" }));
  for (const email of ["", "nobody", "a@b", "a b@c.de"]) assert.ok("error" in parseSend({ amount: "5", currency: "USD", email }), email);
  assert.equal(maskEmail("ravi@example.com"), "r•••@example.com");
});
