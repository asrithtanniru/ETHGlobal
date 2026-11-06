import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { namehash } from 'viem/ens';
import { BILLER_KEY, PAYOUT_KEY, payeeDirectory, resolvePayout } from '../payee.mjs';

const biller = '0x14ce36ac40976c12b726AF5af5bfFFdAac14E0fd';
const other = '0x0000000000000000000000000000000000009999';
const sender = '0x0000000000000000000000000000000000000abc';
const rent = namehash('rent.gharfam.eth');
const directory = payeeDirectory('rent, clinic', 'gharfam.eth');

function deps(records, vaultBiller = biller) {
  return { directory, readText: async (_name, key) => records[key] ?? null, readVaultBiller: async () => vaultBiller };
}
const good = { [PAYOUT_KEY]: 'demo:acct-rent-001', [BILLER_KEY]: biller };

describe('payeeDirectory', () => {
  it('maps namehash to name and ignores blanks', () => {
    assert.equal(directory.get(rent), 'rent.gharfam.eth');
    assert.equal(payeeDirectory('rent,,', 'gharfam.eth').size, 1);
  });
});

describe('resolvePayout', () => {
  it('returns the account reference from ENS', async () => {
    assert.deepEqual(await resolvePayout({ sender, payee: rent }, deps(good)),
      { ok: true, name: 'rent.gharfam.eth', payoutRef: 'demo:acct-rent-001' });
  });

  it('refuses a payee it does not know', async () => {
    const r = await resolvePayout({ sender, payee: namehash('x.gharfam.eth') }, deps(good));
    assert.deepEqual(r, { ok: false, reason: 'unknown payee' });
  });

  it('refuses when a record is missing', async () => {
    assert.equal((await resolvePayout({ sender, payee: rent }, deps({ [BILLER_KEY]: biller }))).ok, false);
    assert.equal((await resolvePayout({ sender, payee: rent }, deps({ [PAYOUT_KEY]: 'x' }))).ok, false);
  });

  it('refuses when the biller changed on ENS after the sender added the payee', async () => {
    const r = await resolvePayout({ sender, payee: rent }, deps(good, other));
    assert.deepEqual(r, { ok: false, reason: 'biller changed: rent.gharfam.eth' });
  });
});
