// Transak staging off-ramp provider.
// Flow: access token -> widget URL (SELL, partnerOrderId) -> operator completes widget once
//       -> adapter auto-sends Sepolia ETH to the deposit address -> poll order -> COMPLETED / FAILED.
import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const API = process.env.TRANSAK_API_BASE || 'https://api-stg.transak.com/partners/api/v2';
const GW = process.env.TRANSAK_GW_BASE || 'https://api-gateway-stg.transak.com/api/v2';
const KEY = process.env.TRANSAK_API_KEY;
const SECRET = process.env.TRANSAK_API_SECRET;

let token;
async function accessToken() {
  if (token) return token;
  const r = await fetch(`${API}/refresh-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-secret': SECRET, 'x-api-key': KEY },
    body: JSON.stringify({ apiKey: KEY }),
  });
  const j = await r.json();
  if (!j.data?.accessToken) throw new Error('Transak token failed: ' + JSON.stringify(j));
  return (token = j.data.accessToken);
}

async function userIp() {
  if (process.env.USER_IP) return process.env.USER_IP;
  return (await (await fetch('https://api.ipify.org')).text()).trim();
}

export async function createSellWidget({ partnerOrderId, cryptoAmount, email, fiatCurrency = 'USD', redirectURL }) {
  const r = await fetch(`${GW}/auth/session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': KEY,
      'access-token': await accessToken(), 'x-user-ip': await userIp(),
    },
    body: JSON.stringify({
      widgetParams: {
        apiKey: KEY, referrerDomain: process.env.REFERRER_DOMAIN || 'localhost',
        productsAvailed: 'SELL', cryptoCurrencyCode: 'ETH', network: 'ethereum',
        cryptoAmount, fiatCurrency, partnerOrderId,
        ...(email ? { email } : {}),
        ...(redirectURL ? { redirectURL } : {}),
      },
    }),
  });
  const j = await r.json();
  if (!j.data?.widgetUrl) throw new Error('widget URL failed: ' + JSON.stringify(j));
  return j.data.widgetUrl;
}

// SELL quotes take an ETH amount only (fiatAmount is ignored); the fiatAmount back is what the payee receives after fees.
export async function quoteSell(cryptoAmount, fiatCurrency = 'USD') {
  const q = new URLSearchParams({ partnerApiKey: KEY, fiatCurrency, cryptoCurrency: 'ETH', network: 'ethereum', isBuyOrSell: 'SELL', cryptoAmount: String(cryptoAmount) });
  const r = await fetch(`${API.replace('/partners/api/v2', '')}/api/v1/pricing/public/quotes?${q}`, { headers: { 'x-api-key': KEY } });
  const j = await r.json();
  const why = j.error?.message || JSON.stringify(j);
  if (/minimum sell/i.test(why)) throw new Error(`This bill is too small for Transak, which sells at least ${why.match(/[\d.]+ ETH/)?.[0] ?? 'a minimum amount'} (about $6.40 to the payee on staging).`);
  if (!j.response?.fiatAmount) throw new Error('Transak quote failed: ' + why);
  return j.response; // { conversionPrice: ETH per fiat unit, fiatAmount, totalFee, ... }
}

/** The ETH to sell so the payee receives `fiat` after Transak's fees, rounded up to 6 decimals. */
export async function ethFor(fiat, fiatCurrency = 'USD') {
  const up6 = (x) => Math.ceil(x * 1e6) / 1e6;
  const probe = await quoteSell(0.01, fiatCurrency);
  // Start from the bill plus the fee, so the first quote clears Transak's minimum sell (about 0.0047 ETH on staging).
  let eth = up6((fiat + probe.totalFee) * probe.conversionPrice);
  let q = await quoteSell(eth, fiatCurrency);
  // The fee is a flat part plus ~1%, so each step closes ~99% of the gap.
  for (let i = 0; i < 2 && Math.abs(fiat - q.fiatAmount) >= 0.01; i++) {
    eth = up6(eth + (fiat - q.fiatAmount) * q.conversionPrice);
    q = await quoteSell(eth, fiatCurrency);
  }
  return { eth: eth.toFixed(6), receives: q.fiatAmount, fee: q.totalFee };
}

export async function getOrder(partnerOrderId) {
  const q = `filter%5BpartnerOrderId%5D=${encodeURIComponent(partnerOrderId)}&filter%5BproductsAvailed%5D=%5B%22SELL%22%5D`;
  const r = await fetch(`${API}/orders?${q}`, { headers: { 'x-api-key': KEY, 'access-token': await accessToken() } });
  const j = await r.json();
  return j.data?.[0] || null; // null until the user finishes the widget
}

// Operator's Sepolia wallet pays the Transak deposit address (stands in for the provider's treasury hot wallet).
const sepoliaRpc = http(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com');
export async function sendDeposit(to, ethAmount) {
  const account = privateKeyToAccount(process.env.SEPOLIA_PRIVATE_KEY || process.env.OPERATOR_PRIVATE_KEY);
  const w = createWalletClient({ chain: sepolia, transport: sepoliaRpc, account });
  const p = createPublicClient({ chain: sepolia, transport: sepoliaRpc });
  const hash = await w.sendTransaction({ to, value: parseEther(String(ethAmount)) });
  await p.waitForTransactionReceipt({ hash });
  return hash;
}

export const DONE = ['COMPLETED'];
export const DEAD = ['FAILED', 'REFUNDED', 'EXPIRED', 'CANCELLED'];
