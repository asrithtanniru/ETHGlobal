import { createWalletClient, erc20Abi, http, parseAbi, parseGwei, parseSignature, toFunctionSelector, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GHAR_VAULT, USDT, settlementChain } from "@ghar/shared";
import { allow, keyEnv, queue } from "@/lib/assistant";
import { chainClient, explain, vault } from "@/lib/chain";
import { depositTypedData, parseDepositAuth, RELAY_MIN } from "@/lib/eip3009";
import { json } from "@/lib/inbox";

export const dynamic = "force-dynamic";

// Kin's relayer pays the WBT gas for gasless deposits. The operator tops this wallet up.
// Drain limits: a relay only goes out after the signer's own signature, USDT balance and unused nonce
// check out and a simulation succeeds, so failed calls cost nothing; each relay moves at least 1 USDT of
// the signer's own money into their own vault; per-wallet and hourly caps bound the spend; gas price is capped.
const relayer = () => { const k = keyEnv("RELAYER_PRIVATE_KEY"); return k ? privateKeyToAccount(k) : undefined; };
const PER_WALLET_PER_HOUR = 3;
const PER_HOUR = Number(process.env.RELAY_HOURLY_LIMIT || 60);
const MAX_GAS_PRICE = parseGwei(process.env.RELAY_MAX_GAS_PRICE_GWEI || "50");
const MIN_RELAYER_WBT = 10n ** 15n;
const tokenAbi = parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]);
const sends = queue();

// Only the redeployed vault has depositWithAuthorization; the app falls back to approve + deposit before that.
let supported: Promise<boolean> | undefined;
const vaultSupportsGasless = () => (supported ??= chainClient.getCode({ address: GHAR_VAULT })
  .then((code) => !!code?.includes(toFunctionSelector("depositWithAuthorization(address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)").slice(2)))
  .catch(() => { supported = undefined; return false; }));

/** Whether gasless deposits are on, and the relayer's address for the README and the demo. */
export async function GET() {
  const r = relayer();
  return json({ enabled: !!r && (await vaultSupportsGasless()), relayer: r?.address ?? null, minUsdt: "1" });
}

export async function POST(req: Request) {
  const account = relayer();
  if (!account || !(await vaultSupportsGasless())) return json({ error: "Deposits without gas aren't available on this vault." }, 503);
  const auth = parseDepositAuth(await req.json().catch(() => null), Math.floor(Date.now() / 1000));
  if ("error" in auth) return json({ error: auth.error }, 400);
  const typed = depositTypedData(auth.from, auth.value, auth.validBefore, auth.nonce);
  if (!(await verifyTypedData({ address: auth.from, ...typed, signature: auth.signature }).catch(() => false)))
    return json({ error: "That deposit wasn't signed by this wallet." }, 403);
  if (!allow(`relay:${auth.from}`, PER_WALLET_PER_HOUR, 3_600_000)) return json({ error: "You've used deposits without gas a few times this hour. Try again later." }, 429);

  try {
    const [balance, used, gasPrice, wbt] = await Promise.all([
      chainClient.readContract({ address: USDT.address, abi: erc20Abi, functionName: "balanceOf", args: [auth.from] }),
      chainClient.readContract({ address: USDT.address, abi: tokenAbi, functionName: "authorizationState", args: [auth.from, auth.nonce] }),
      chainClient.getGasPrice(),
      chainClient.getBalance({ address: account.address }),
    ]);
    if (used) return json({ error: "This signed deposit was already used." }, 409);
    if (balance < auth.value) return json({ error: "Your wallet doesn't hold that much USDT." }, 422);
    if (gasPrice > MAX_GAS_PRICE) return json({ error: "Whitechain gas is unusually high right now. Try again soon." }, 503);
    if (wbt < MIN_RELAYER_WBT) return json({ error: "Kin's relayer is out of gas money. Deposit with your own gas for now." }, 503);
    // Counted only after the checks above, so wallets without real USDT can't use up the shared budget.
    if (!allow("relay:all", PER_HOUR, 3_600_000)) return json({ error: "Kin's relayer is busy. Try again in a while." }, 429);

    const sig = parseSignature(auth.signature);
    const v = Number(sig.v ?? BigInt(sig.yParity + 27));
    const hash = await sends(async () => {
      const { request } = await chainClient.simulateContract({
        ...vault, account, functionName: "depositWithAuthorization",
        args: [auth.from, auth.value, 0n, auth.validBefore, auth.nonce, v, sig.r, sig.s],
      });
      const wallet = createWalletClient({ chain: settlementChain, account, transport: http(process.env.NEXT_PUBLIC_WHITECHAIN_RPC_URL ?? "https://rpc.testnet.whitechain.io") });
      return wallet.writeContract(request);
    });
    const receipt = await chainClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") return json({ error: "The deposit transaction reverted." }, 502);
    return json({ hash, minUsdt: RELAY_MIN.toString() });
  } catch (e) {
    return json({ error: explain(e) }, 422);
  }
}
