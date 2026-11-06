import { test } from "node:test";
import assert from "node:assert/strict";
import { namehash } from "viem/ens";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { gharVaultAbi, PAYEE_BOOK_PARENT } from "@ghar/shared";
import { explain, parseUsdt, usdt, vaultEvents } from "../lib/chain.ts";
import { nameFor } from "../lib/names.ts";

test("parseUsdt accepts 6-decimal amounts and rejects bad input", () => {
  assert.equal(parseUsdt("12.5"), 12_500_000n);
  assert.equal(parseUsdt(" 1 "), 1_000_000n);
  for (const bad of ["", "0", "-1", "1.1234567", "abc", "1e3"]) assert.equal(parseUsdt(bad), undefined, bad);
  assert.equal(usdt(1_234_560_000n), "1,234.56");
});

test("explain maps vault custom errors to plain sentences", () => {
  const data = encodeErrorResult({ abi: gharVaultAbi, errorName: "NomineeLocked", args: [123n] });
  const err = new BaseError("reverted", { cause: new ContractFunctionRevertedError({ abi: gharVaultAbi, data, functionName: "nomineeWithdraw" }) });
  assert.match(explain(err), /nominee timer/);
});

test("nameFor recovers common payee names from their namehash", () => {
  assert.equal(nameFor(namehash(`rent.${PAYEE_BOOK_PARENT}`)), `rent.${PAYEE_BOOK_PARENT}`);
  assert.equal(nameFor(namehash("unknown.example.eth")), undefined);
});

// Live read against Whitechain Sepolia: filters reach the RPC and the deployment block is valid.
test("vaultEvents reads the vault's logs", { skip: process.env.OFFLINE === "1" }, async () => {
  assert.ok(Array.isArray(await vaultEvents("PayeeSet", { sender: "0x6A815099F474758778C95a8EFdd3654f09eA7d1a" })));
});
