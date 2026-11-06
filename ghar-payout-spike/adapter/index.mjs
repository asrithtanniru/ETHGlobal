// Ghar payout adapter: GharVault PayoutRequested -> check the payee on ENS -> provider payout
// -> markPaid or refund on the vault. Its key must be the vault's immutable `provider`.
import fs from 'node:fs';
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, formatUnits, isAddressEqual } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as onramp from './onramp.mjs';
import * as transak from './transak.mjs';
import { payeeDirectory, resolvePayout } from './payee.mjs';

const PROVIDER = (process.env.PROVIDER || 'onramp').toLowerCase();

const whitechainSepolia = defineChain({
  id: 1874,
  name: 'Whitechain Sepolia',
  nativeCurrency: { name: 'WBT', symbol: 'WBT', decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL || 'https://rpc.testnet.whitechain.io'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://explorer.testnet.whitechain.io' } },
});
const EXPLORER = 'https://explorer.testnet.whitechain.io';

const abi = parseAbi([
  'event PayoutRequested(address indexed sender, bytes32 indexed payee, bytes32 indexed digest, bytes32 invoiceRef, uint256 amount, address agent)',
  'function markPaid(bytes32 digest, string providerRef)',
  'function refund(bytes32 digest, string reason)',
  'function provider() view returns (address)',
  'function billerOf(address sender, bytes32 payee) view returns (address)',
]);

const CONTRACT = process.env.GHAR_VAULT_ADDRESS;
const account = privateKeyToAccount(process.env.OPERATOR_PRIVATE_KEY);
const pub = createPublicClient({ chain: whitechainSepolia, transport: http() });
const wallet = createWalletClient({ chain: whitechainSepolia, transport: http(), account });
const ens = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com') });
const directory = payeeDirectory(process.env.PAYEE_TAGS || 'rent', process.env.PAYEE_BOOK_PARENT || 'gharfam.eth');
const payeesFile = new URL('./payees.json', import.meta.url);
const payees = fs.existsSync(payeesFile) ? JSON.parse(fs.readFileSync(payeesFile)) : {};
const FAIL_NEXT = process.env.SIMULATE_FAILURE === '1'; // set to show the refund path

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const readText = (name, key) => ens.getEnsText({ name, key });
const readVaultBiller = (sender, payee) =>
  pub.readContract({ address: CONTRACT, abi, functionName: 'billerOf', args: [sender, payee] });

async function handle({ sender, payee, digest, amount }, txHash) {
  const usdt = formatUnits(amount, 6);
  log(`\n[Whitechain] payout ${digest.slice(0, 10)}: ${usdt} USDT from ${sender}`);
  log(`  tx ${EXPLORER}/tx/${txHash}`);

  // A failed lookup refunds: the USDT stays with the sender and the biller can sign a new bill.
  const check = await resolvePayout({ sender, payee }, { directory, readText, readVaultBiller })
    .catch((e) => ({ ok: false, reason: `ENS lookup failed: ${e.shortMessage || e.message}` }));
  if (!check.ok) return finish('refund', digest, check.reason);
  log(`[ENS] ${check.name} payoutRef=${check.payoutRef}`);

  return PROVIDER === 'transak' ? handleTransak(digest, usdt, check) : handleOnramp(digest, usdt, check);
}

async function handleOnramp(digest, usdt, { payoutRef }) {
  const payee = payees[payoutRef];
  if (!payee) return finish('refund', digest, `no provider payee for ${payoutRef}`);

  // Settling stays outside the try: a failed markPaid must never turn into a refund,
  // or the sender gets the USDT back after the payee was already paid.
  let result;
  try {
    const q = await onramp.quote(usdt);
    const src = onramp.MOCK ? (q.source === 'onramp-public-live' ? ' LIVE RATE' : ' MOCK RATE') : ' sandbox';
    log(`[Onramp${src}] quote: ${usdt} USDT -> Rs ${q.toAmount} (rate ${q.rate})`, q.fees ? JSON.stringify(q.fees) : '');

    const order = await onramp.createOfframp({ ...payee, fromAmount: usdt, toAmount: q.toAmount, rate: q.rate });
    log(`[Onramp] order ${order.transactionId} created, deposit address ${order.depositAddress?.address}`);

    // Sandbox has no real deposit, so walk the order through its states.
    const steps = FAIL_NEXT ? [10, -1] : [10, 12, 13, 14];
    for (const s of steps) {
      await onramp.sandboxSetOfframpStatus(payee.customerId, order.transactionId, s);
      log(`[Onramp] status ${s}: ${onramp.STATUS[String(s)]}`);
      await sleep(1500);
    }

    const tx = await onramp.getOfframp(payee.customerId, order.transactionId, FAIL_NEXT ? '-1' : '14', q.toAmount);
    result = ['6', '14', '19'].includes(String(tx.status))
      ? ['paid', order.transactionId, `Rs ${tx.toAmount || q.toAmount}`]
      : ['refund', `provider status ${tx.status} (${onramp.STATUS[String(tx.status)] || 'unknown'})`];
  } catch (e) {
    log('[Onramp] error:', e.message);
    result = ['refund', 'provider error'];
  }
  return finish(result[0], digest, result[1], result[2]);
}

// ---- Transak staging: real provider order, real testnet deposit, real status ----
async function handleTransak(digest, usdt, { name, payoutRef }) {
  const partnerOrderId = `ghar-${CONTRACT.slice(2, 8)}-${digest.slice(2, 10)}-${Date.now()}`;
  const ethAmount = process.env.TRANSAK_SELL_ETH || '0.02'; // staging sells Sepolia ETH; amount is fixed for the demo
  const email = process.env.TRANSAK_EMAIL; // use name+failed@... to demo the refund path
  let result = ['refund', 'Transak order timed out'];
  try {
    const url = await transak.createSellWidget({ partnerOrderId, cryptoAmount: Number(ethAmount), email });
    log(`[Transak sandbox] order ${partnerOrderId}: payout for ${usdt} USDT to ${name} (${payoutRef})`);
    log(`  OPEN WITHIN 5 MIN and confirm (test card 4024 7644 4997 1519, 10/33, CVV 000):\n  ${url}`);

    let order, sent = false, last = '';
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      await sleep(5000);
      order = await transak.getOrder(partnerOrderId).catch(() => null);
      if (!order) continue;
      if (order.status !== last) { last = order.status; log(`[Transak] ${order.id}: ${order.status}`); }
      if (!sent && order.status === 'AWAITING_PAYMENT_FROM_USER' && order.cryptoPaymentData?.paymentAddress) {
        const h = await transak.sendDeposit(order.cryptoPaymentData.paymentAddress, ethAmount);
        sent = true;
        log(`[Sepolia] deposited ${ethAmount} ETH to Transak: https://sepolia.etherscan.io/tx/${h}`);
      }
      if (transak.DONE.includes(order.status)) {
        result = ['paid', order.id, `${order.fiatAmount} ${order.fiatCurrency}`];
        break;
      }
      if (transak.DEAD.includes(order.status)) {
        result = ['refund', `Transak order ${order.status}`];
        break;
      }
    }
  } catch (e) {
    log('[Transak] error:', e.message);
    result = ['refund', 'provider error'];
  }
  return finish(result[0], digest, result[1], result[2]);
}

async function finish(kind, digest, detail, delivered) {
  const hash = await wallet.writeContract({
    address: CONTRACT, abi, functionName: kind === 'paid' ? 'markPaid' : 'refund', args: [digest, detail],
  });
  await pub.waitForTransactionReceipt({ hash });
  log(kind === 'paid'
    ? `[Whitechain] markPaid ${digest.slice(0, 10)}: ${delivered} delivered, USDT released to provider`
    : `[Whitechain] refund ${digest.slice(0, 10)}: ${detail}, USDT back in the sender's balance`);
  log(`  tx ${EXPLORER}/tx/${hash}`);
}

const provider = await pub.readContract({ address: CONTRACT, abi, functionName: 'provider' });
if (!isAddressEqual(provider, account.address)) {
  throw new Error(`OPERATOR_PRIVATE_KEY is ${account.address}, but the vault's provider is ${provider}`);
}

log(`Ghar adapter watching ${CONTRACT} on Whitechain Sepolia (provider ${account.address})`);
log(`Payees: ${[...directory.values()].join(', ')}`);
log(PROVIDER === 'transak' ? 'Provider: Transak staging (real sell order, Sepolia ETH deposit)'
  : onramp.MOCK ? 'Provider: Onramp, MOCK mode (live rate, simulated payout)' : 'Provider: Onramp sandbox');

const seen = new Set();
pub.watchContractEvent({
  address: CONTRACT, abi, eventName: 'PayoutRequested', pollingInterval: 2000,
  onLogs: async (logs) => {
    for (const l of logs) {
      const key = `${l.transactionHash}:${l.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // A settle that failed leaves the payout pending, so it is logged, never retried as a refund.
      await handle(l.args, l.transactionHash).catch((e) =>
        log(`[Adapter] payout ${l.args.digest} NOT SETTLED, needs a manual look: ${e.shortMessage || e.message}`));
    }
  },
  onError: (e) => log('watch error:', e.message),
});
