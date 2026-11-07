// P2P.me off-ramp for INR sends: the provider sells USDC from its Base float, and a P2P.me merchant
// pays the friend's UPI ID. Flow: place SELL -> merchant accepts -> approve + hand over the encrypted
// UPI ID (USDC is pulled into escrow here) -> merchant pays the UPI ID and completes the order.
import { concat, formatUnits, createPublicClient, createWalletClient, erc20Abi, http, keccak256, toHex, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createOrders, type Order } from "@p2pdotme/sdk/orders";
import { createPrices } from "@p2pdotme/sdk/prices";
import { validateUPIId } from "@p2pdotme/sdk/country";

// Base Sepolia defaults: the live P2P.me Diamond, its test USDC and its subgraph.
const DIAMOND = (process.env.P2P_DIAMOND_ADDRESS || "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9") as Hex;
const USDC = (process.env.P2P_USDC_ADDRESS || "0x4095fE4f1E636f11A95820BA2bB87F335Bd1040d") as Hex;
const SUBGRAPH = process.env.P2P_SUBGRAPH_URL || "https://api.studio.thegraph.com/query/1745491/event-indexer/version/latest";

let client: ReturnType<typeof make> | undefined;
function make() {
  // The same treasury key that pays Transak on Sepolia holds the USDC float on Base Sepolia.
  const key = (process.env.SEPOLIA_PRIVATE_KEY || process.env.OPERATOR_PRIVATE_KEY) as Hex;
  if (!key) throw new Error("SEPOLIA_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(key);
  const transport = http(process.env.BASE_SEPOLIA_RPC_URL || "https://base-sepolia-rpc.publicnode.com");
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ chain: baseSepolia, transport, account });
  // A fixed relay key, so the UPI ID sealed at placement still opens after a restart.
  const relayKey = keccak256(concat([key, toHex("ghar-p2p-relay")]));
  const relay = privateKeyToAccount(relayKey);
  const relayIdentity = { address: relay.address, publicKey: relay.publicKey.slice(4), privateKey: relayKey };
  const cfg = { publicClient: publicClient as never, diamondAddress: DIAMOND, usdcAddress: USDC, subgraphUrl: SUBGRAPH };
  return { account, publicClient, walletClient, relayIdentity, orders: createOrders({ ...cfg, relayIdentity }), prices: createPrices(cfg) };
}
const p2p = () => (client ??= make());

/** Throws before anything is sent when the provider's USDC float can't cover `need` (the pull would cancel the order). */
async function ensureFloat(need: bigint) {
  const { account, publicClient } = p2p();
  const have = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (have < need) throw new Error(`The provider's P2P.me float on Base Sepolia holds ${formatUnits(have, 6)} USDC, and this payout needs ${formatUnits(need, 6)}. Top it up first.`);
}

/** The SDK returns Results; this unwraps them so failures throw like the rest of the payout steps. */
type Res<T> = { match<A, B = A>(ok: (v: T) => A, err: (e: { message: string }) => B): PromiseLike<A | B> };
const ok = <T>(r: Res<T>, what: string): Promise<T> =>
  Promise.resolve(r.match((v) => v, (e) => { throw new Error(`P2P.me ${what} failed: ${e.message}`); }));

export const validUpi = (upi: string) => validateUPIId(upi);

/** The UPI ID encrypted to our own relay key, safe to keep in the journal until a merchant accepts. */
export const sealUpi = (upi: string) =>
  ok(p2p().orders.encryptPaymentAddress({ paymentAddress: upi, recipientPublicKey: p2p().relayIdentity.publicKey }), "seal");

/** Places the SELL order for `usdc` (6 decimals) at today's INR sell price. No USDC moves yet.
 *  `onSend` runs after a dry run passes and before anything is broadcast. */
export async function placeSell(usdc: bigint, onSend: () => void): Promise<{ orderId: bigint; hash: Hex }> {
  const { orders, prices, account, publicClient, walletClient } = p2p();
  const price = await ok(prices.getPriceConfig({ currency: "INR" }), "price");
  const params = {
    orderType: 1, currency: "INR" as const, user: account.address, recipientAddr: account.address,
    amount: usdc, fiatAmount: (usdc * price.sellPrice) / 1_000_000n,
  };
  // Over the sell limit or no merchant circle: refused here, before an order exists.
  await ensureFloat(usdc);
  const tx = await ok(orders.placeOrder.prepare(params), "route order");
  await publicClient.call({ account, to: tx.to, data: tx.data });
  onSend();
  const placed = await ok(orders.placeOrder.execute({ walletClient: walletClient as never, waitForReceipt: true, ...params }), "place order");
  if (placed.meta?.orderId === undefined) throw new Error(`P2P.me order id missing from ${placed.hash}`);
  return { orderId: placed.meta.orderId, hash: placed.hash };
}

export const getOrder = (orderId: bigint) => ok(p2p().orders.getOrder({ orderId }), "read order");

/** Approves what the Diamond pulls (amount plus any small-order fee), then hands the merchant the UPI ID.
 *  `onSend` runs after the float check and a dry run pass, right before the handover is broadcast. */
export async function deliverUpi(order: Order, sealedUpi: string, onSend: () => void): Promise<Hex> {
  const { orders, account, publicClient, walletClient } = p2p();
  // Approving only the amount makes the pull revert, and the Diamond then cancels the order.
  if (order.actualUsdcAmount < order.usdcAmount) throw new Error(`P2P.me order ${order.orderId} reports a short pull amount`);
  await ensureFloat(order.actualUsdcAmount);
  const allowance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, DIAMOND] });
  if (allowance < order.actualUsdcAmount)
    await ok(orders.approveUsdc.execute({ walletClient: walletClient as never, waitForReceipt: true, amount: order.actualUsdcAmount }), "approve");
  const upi = await ok(orders.decryptPaymentAddress({ encrypted: sealedUpi }), "unseal");
  const params = { orderId: order.orderId, paymentAddress: upi, merchantPublicKey: order.pubkey, updatedFiatAmount: 0n };
  const tx = await ok(orders.setSellOrderUpiWithFiat.prepare(params), "prepare UPI");
  await publicClient.call({ account, to: tx.to, data: tx.data });
  onSend();
  const sent = await ok(orders.setSellOrderUpiWithFiat.execute({ walletClient: walletClient as never, waitForReceipt: true, ...params }), "send UPI");
  return sent.hash;
}
