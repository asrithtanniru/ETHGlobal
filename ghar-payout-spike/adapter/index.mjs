// Ghar payout adapter (spike):
// Whitechain PayoutRequested event -> Onramp sandbox USDT->INR payout -> markPaid / refund on Whitechain.
import fs from 'node:fs';
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, formatUnits, hexToString } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as onramp from './onramp.mjs';
import * as transak from './transak.mjs';

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
  'event PayoutRequested(uint256 indexed id, address indexed sender, uint256 amount, bytes32 payeeRef)',
  'function markPaid(uint256 id, string providerTxId, uint256 inrPaise)',
  'function refund(uint256 id, string reason)',
]);

const CONTRACT = process.env.GHAR_PAYOUT_ADDRESS;
const account = privateKeyToAccount(process.env.OPERATOR_PRIVATE_KEY);
const pub = createPublicClient({ chain: whitechainSepolia, transport: http() });
const wallet = createWalletClient({ chain: whitechainSepolia, transport: http(), account });
const payeesFile = new URL('./payees.json', import.meta.url);
const payees = fs.existsSync(payeesFile) ? JSON.parse(fs.readFileSync(payeesFile)) : {};
const FAIL_NEXT = process.env.SIMULATE_FAILURE === '1'; // set to show the refund path

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function handle({ id, sender, amount, payeeRef }, txHash) {
  const usdt = formatUnits(amount, 6);
  const label = hexToString(payeeRef, { size: 32 }).replace(/\0/g, '');
  log(`\n[Whitechain] payout #${id}: ${usdt} USDT from ${sender} to "${label}"`);
  log(`  tx ${EXPLORER}/tx/${txHash}`);

  if (PROVIDER === 'transak') return handleTransak(id, usdt, label);

  const payee = payees[label];
  if (!payee) return finish('refund', id, `unknown payee "${label}"`);

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
    if (['6', '14', '19'].includes(String(tx.status))) {
      const paise = BigInt(Math.round(Number(tx.toAmount || q.toAmount) * 100));
      await finish('paid', id, order.transactionId, paise, tx.toAmount || q.toAmount);
    } else {
      await finish('refund', id, `provider status ${tx.status} (${onramp.STATUS[String(tx.status)] || 'unknown'})`);
    }
  } catch (e) {
    log('[Onramp] error:', e.message);
    await finish('refund', id, 'provider error');
  }
}

// ---- Transak staging: real provider order, real testnet deposit, real status ----
async function handleTransak(id, usdt, label) {
  const partnerOrderId = `ghar-${CONTRACT.slice(2, 8)}-${id}-${Date.now()}`;
  const ethAmount = process.env.TRANSAK_SELL_ETH || '0.02'; // staging sells Sepolia ETH; amount is fixed for the demo
  const email = process.env.TRANSAK_EMAIL; // use name+failed@... to demo the refund path
  try {
    const url = await transak.createSellWidget({ partnerOrderId, cryptoAmount: Number(ethAmount), email });
    log(`[Transak sandbox] order ${partnerOrderId}: payout for ${usdt} USDT to "${label}"`);
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
        const cents = BigInt(Math.round(Number(order.fiatAmount) * 100));
        return finish('paid', id, order.id, cents, `${order.fiatAmount} ${order.fiatCurrency}`);
      }
      if (transak.DEAD.includes(order.status)) return finish('refund', id, `Transak order ${order.status}`);
    }
    return finish('refund', id, 'Transak order timed out');
  } catch (e) {
    log('[Transak] error:', e.message);
    return finish('refund', id, 'provider error');
  }
}

async function finish(kind, id, a, paise, inr) {
  const hash = kind === 'paid'
    ? await wallet.writeContract({ address: CONTRACT, abi, functionName: 'markPaid', args: [id, a, paise] })
    : await wallet.writeContract({ address: CONTRACT, abi, functionName: 'refund', args: [id, a] });
  await pub.waitForTransactionReceipt({ hash });
  log(kind === 'paid'
    ? `[Whitechain] markPaid #${id}: ${PROVIDER === 'transak' ? inr : 'Rs ' + inr} delivered, USDT released to treasury`
    : `[Whitechain] refund #${id}: ${a}, USDT back to sender`);
  log(`  tx ${EXPLORER}/tx/${hash}`);
}

log(`Ghar adapter watching ${CONTRACT} on Whitechain Sepolia (operator ${account.address})`);
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
      await handle(l.args, l.transactionHash);
    }
  },
  onError: (e) => log('watch error:', e.message),
});
