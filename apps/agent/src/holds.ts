import { appendFileSync, readFileSync } from "node:fs";
import { parseKeys } from "./llm.ts";

/** Bill digests the sender approved after an AI hold. Invoice refs won't do: the biller can reuse one on a new bill. */
export const parseDigests = (value: string | undefined) => new Set(parseKeys(value).map((digest) => digest.toLowerCase()));

/** Bills still held from earlier runs. An unreadable file throws: forgetting a hold could pay the bill. */
export function loadHolds(path: string, approved: Set<string>) {
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").split("\n");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Set<string>();
    throw e;
  }
  return new Set(lines.filter((digest) => digest && !approved.has(digest)));
}

export const recordHold = (path: string, digest: string) => appendFileSync(path, `${digest}\n`);
