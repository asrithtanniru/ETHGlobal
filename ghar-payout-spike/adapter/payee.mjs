// Maps a vault payout back to a verified ENS payee. The vault only emits the namehash, and a
// namehash cannot be reversed, so the adapter is told which payee tags to expect.
import { isAddressEqual } from 'viem';
import { namehash, normalize } from 'viem/ens';

export const PAYOUT_KEY = 'ghar.payoutRef';
export const BILLER_KEY = 'ghar.biller';

/** "rent,clinic" + "gharfam.eth" -> Map(namehash -> "rent.gharfam.eth"). */
export function payeeDirectory(tags, parent) {
  const names = tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => normalize(`${t}.${parent}`));
  return new Map(names.map((name) => [namehash(name), name]));
}

/**
 * The provider's own check before paying out. Records come from ENS, never from the event, so
 * nothing the agent sent can change which account gets paid.
 */
export async function resolvePayout({ sender, payee }, { directory, readText, readVaultBiller }) {
  const name = directory.get(payee);
  if (!name) return { ok: false, reason: 'unknown payee' };

  const [payoutRef, biller, vaultBiller] = await Promise.all([
    readText(name, PAYOUT_KEY),
    readText(name, BILLER_KEY),
    readVaultBiller(sender, payee),
  ]);
  if (!payoutRef || !biller) return { ok: false, reason: `missing ENS records: ${name}` };
  if (!isAddressEqual(biller, vaultBiller)) return { ok: false, reason: `biller changed: ${name}` };
  return { ok: true, name, payoutRef };
}
