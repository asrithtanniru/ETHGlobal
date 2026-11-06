// Minimal Onramp.money white-label client (sandbox by default).
// Auth per docs: payload = base64(JSON{body, timestamp}), signature = hex(HMAC-SHA512(payload, secret)).
import crypto from 'node:crypto';

const BASE = process.env.ONRAMP_BASE_URL || 'https://api-test.onramp.money';
const KEY = process.env.ONRAMP_API_KEY;
const SECRET = process.env.ONRAMP_API_SECRET;
export const MOCK = !KEY || !SECRET || process.env.ONRAMP_MOCK === '1';

async function call(path, body) {
  const timestamp = Date.now().toString();
  const payload = Buffer.from(JSON.stringify({ body, timestamp })).toString('base64');
  const signature = crypto.createHmac('sha512', SECRET).update(payload).digest('hex');
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
      // The docs show both header styles; send both.
      apikey: KEY, payload, signature, timestamp,
      'X-ONRAMP-APIKEY': KEY, 'X-ONRAMP-PAYLOAD': payload, 'X-ONRAMP-SIGNATURE': signature,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ status: 0, error: `HTTP ${res.status}` }));
  if (json.status !== 1) throw new Error(`${path} failed: ${JSON.stringify(json)}`);
  return json.data;
}

const W = '/onramp/api/v2/whiteLabel';

// ---- payee onboarding (run once per payee) ----
export const createUser = (b) => call(`${W}/kyc/url`, b);
export const sandboxSetKyc = (customerId, status = 'COMPLETED') =>
  call(`${W}/test/changeKycStatus`, { customerId, status });
export const addFiatAccount = (b) => call(`${W}/bank/addFiatAccount`, b);

// ---- payouts ----
// Public, no API key: live USDT price in INR plus the bank gateway fee tiers.
// https://docs.onramp.money/onramp/offramp-widget-integration/get-all-coin-details-v2
async function liveQuote(fromAmount, chain) {
  const res = await fetch('https://api.onramp.money/onramp/api/v2/sell/public/allConfig');
  const { data } = await res.json();
  const coinId = data.allCoinConfig.usdt.coinId;
  const netId = Object.entries(data.networkConfig).find(([, n]) => n.chainSymbol === chain)?.[0];
  const price = data.coinData[coinId];
  const rate = Number(typeof price === 'object' ? (price[netId] ?? Object.values(price)[0]) : price);
  const gross = Number(fromAmount) * rate;
  const tiers = Object.entries(data.gatewayFee?.['1'] || {}).map(([max, fee]) => [Number(max), Number(fee)]).sort((a, b) => a[0] - b[0]);
  const gatewayFee = (tiers.find(([max]) => gross <= max) || tiers.at(-1) || [0, 0])[1];
  const tdsFee = +(gross * 0.01).toFixed(2); // 1% TDS (India)
  const toAmount = (gross - gatewayFee - tdsFee).toFixed(2);
  return {
    fromCurrency: 'usdt', toCurrency: 'INR', fromAmount, toAmount, rate: rate.toFixed(4),
    fees: [{ type: 'fiat', gatewayFee: String(gatewayFee), tdsFee: String(tdsFee), note: 'live rate, excludes Onramp fee' }],
    source: 'onramp-public-live',
  };
}

export async function quote(fromAmount, chain = 'matic20') {
  if (MOCK) {
    try {
      return await liveQuote(fromAmount, chain);
    } catch (e) {
      const rate = 88.5, toAmount = (Number(fromAmount) * rate * 0.985).toFixed(2);
      return { fromCurrency: 'usdt', toCurrency: 'INR', fromAmount, toAmount, rate: String(rate), source: 'fixed-fallback' };
    }
  }
  return call(`${W}/offramp/quote`, { fromCurrency: 'usdt', toCurrency: 'INR', chain, fromAmount: String(fromAmount) });
}

export async function createOfframp({ customerId, fiatAccountId, fromAmount, toAmount, rate, chain = 'matic20' }) {
  if (MOCK) return { transactionId: 'mock-' + Date.now(), depositAddress: { address: '0xMOCK', chain: 'MATIC20' } };
  return call(`${W}/offramp/createTransaction`, {
    fromCurrency: 'usdt', toCurrency: 'INR', chain, fiatAccountId, customerId,
    fromAmount: String(fromAmount), toAmount: String(toAmount), rate: String(rate),
  });
}

// Sandbox only: push the order through its lifecycle. Statuses from the docs:
// 10 deposit received -> 12 crypto sold -> 13 fiat transfer initiated -> 14 fiat transfer completed; -1 failed.
export async function sandboxSetOfframpStatus(customerId, transactionId, status) {
  if (MOCK) return { changeStatus: true, message: `MOCK status ${status}` };
  return call(`${W}/test/changeOfframpStatus`, { customerId, transactionId, status: String(status) });
}

export async function getOfframp(customerId, transactionId, mockStatus = '14', mockToAmount = '0') {
  if (MOCK) return { transactionId, status: mockStatus, toAmount: mockToAmount };
  return call(`${W}/offramp/transaction`, { customerId, transactionId });
}

export const STATUS = {
  '-6': 'refunded', '-4': 'amount mismatch', '-2': 'abandoned', '-1': 'timed out / failed',
  '0': 'order created', '1': 'order confirmed', '2': 'deposit found', '10': 'deposit found', '11': 'deposit found',
  '4': 'crypto sold', '12': 'crypto sold', '5': 'INR transfer initiated', '13': 'INR transfer initiated',
  '6': 'INR sent to bank', '14': 'INR sent to bank', '19': 'success',
};
