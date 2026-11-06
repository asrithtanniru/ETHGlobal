import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHolds, parseDigests, recordHold } from "../src/holds.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "holds-")), ".agent-holds");

test("no file means no holds", () => {
  assert.deepEqual([...loadHolds(file(), new Set())], []);
});

test("holds survive a restart", () => {
  const path = file();
  recordHold(path, "0xa");
  recordHold(path, "0xb");
  assert.deepEqual([...loadHolds(path, new Set())], ["0xa", "0xb"]);
});

test("approving one bill leaves the other held", () => {
  const path = file();
  recordHold(path, "0xa");
  recordHold(path, "0xb");
  assert.deepEqual([...loadHolds(path, parseDigests("0xA"))], ["0xb"]);
});

test("an unreadable holds file stops the agent", () => {
  assert.throws(() => loadHolds(tmpdir(), new Set()), /EISDIR/);
});

test("digests are matched in lower case", () => {
  assert.deepEqual([...parseDigests(" 0xAB, 0xcd ,")], ["0xab", "0xcd"]);
});
