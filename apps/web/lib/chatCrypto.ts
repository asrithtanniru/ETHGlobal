// Chat bodies are public on Arkiv, so they are sealed with AES-256-GCM under a per-owner key
// derived from CHAT_SECRET. Only the indexed columns (owner, thread, seq, at) are readable.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Hex } from "viem";

function keyFor(secret: string, owner: string) {
  if (secret.length < 32) throw new Error("CHAT_SECRET must be at least 32 characters");
  return Buffer.from(hkdfSync("sha256", secret, "ghar-chat-v1", owner.toLowerCase(), 32));
}

/** iv (12) | tag (16) | ciphertext, as hex. */
export function seal(secret: string, owner: string, data: unknown): Hex {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(secret, owner), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return `0x${Buffer.concat([iv, c.getAuthTag(), ct]).toString("hex")}`;
}

/** Throws when the body was sealed for another owner or altered. */
export function unseal<T>(secret: string, owner: string, body: Hex): T {
  const raw = Buffer.from(body.slice(2), "hex");
  const d = createDecipheriv("aes-256-gcm", keyFor(secret, owner), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8")) as T;
}
