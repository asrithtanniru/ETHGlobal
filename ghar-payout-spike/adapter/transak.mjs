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

export async function createSellWidget({ partnerOrderId, cryptoAmount, email }) {
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
        cryptoAmount, fiatCurrency: 'USD', partnerOrderId,
        ...(email ? { email } : {}),
      },
    }),
  });
  const j = await r.json();
  if (!j.data?.widgetUrl) throw new Error('widget URL failed: ' + JSON.stringify(j));
  return j.data.widgetUrl;
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
