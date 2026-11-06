import { BaseError, ContractFunctionRevertedError, createPublicClient, formatUnits, http, parseUnits, type Address, type Hex } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { GHAR_VAULT, GHAR_VAULT_DEPLOY_BLOCK, USDT, ensChain, gharVaultAbi, settlementChain } from "@ghar/shared";

const SEPOLIA_RPC = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const WHITECHAIN_RPC = process.env.NEXT_PUBLIC_WHITECHAIN_RPC_URL ?? "https://rpc.testnet.whitechain.io";

export const wagmiConfig = createConfig({
  chains: [settlementChain, ensChain],
  connectors: [injected()],
  transports: { [settlementChain.id]: http(WHITECHAIN_RPC), [ensChain.id]: http(SEPOLIA_RPC) },
  ssr: true,
});

export const chainClient = createPublicClient({ chain: settlementChain, transport: http(WHITECHAIN_RPC) });
export const ensClient = createPublicClient({ chain: ensChain, transport: http(SEPOLIA_RPC) });

export const vault = { address: GHAR_VAULT, abi: gharVaultAbi, chainId: settlementChain.id } as const;

export const DEPLOY_BLOCK = GHAR_VAULT_DEPLOY_BLOCK;
/** Whitechain RPC rejects eth_getLogs over more than 10,000 blocks. */
const LOG_RANGE = 9_999n;

type EventName = Extract<(typeof gharVaultAbi)[number], { type: "event" }>["name"];

/** Reads vault events from deployment to head in RPC-sized chunks, oldest first. */
export async function vaultEvents(eventName: EventName, args?: Record<string, unknown>) {
  const chunks = await Promise.all(
    (await blockRanges()).map(([fromBlock, toBlock]) =>
      chainClient.getContractEvents({ address: GHAR_VAULT, abi: gharVaultAbi, eventName, args: args as never, fromBlock, toBlock }),
    ),
  );
  return chunks.flat();
}

/** Payees currently in a sender's vault, as namehashes, replaying PayeeSet and PayeeRemoved in order. */
export async function activePayees(sender: Address): Promise<Hex[]> {
  const [set, removed] = await Promise.all([vaultEvents("PayeeSet", { sender }), vaultEvents("PayeeRemoved", { sender })]);
  const alive = new Map<Hex, boolean>();
  for (const { e, on } of [...set.map((e) => ({ e, on: true })), ...removed.map((e) => ({ e, on: false }))]
    .sort((a, b) => Number(a.e.blockNumber - b.e.blockNumber) || a.e.logIndex - b.e.logIndex)) {
    alive.set((e.args as { payee: Hex }).payee, on);
  }
  return [...alive].filter(([, on]) => on).map(([n]) => n);
}

async function blockRanges() {
  const head = await chainClient.getBlockNumber();
  const ranges: [bigint, bigint][] = [];
  for (let from = DEPLOY_BLOCK; from <= head; from += LOG_RANGE + 1n) {
    ranges.push([from, from + LOG_RANGE > head ? head : from + LOG_RANGE]);
  }
  return ranges;
}

export const usdt = (v: bigint | undefined) =>
  v === undefined ? "—" : Number(formatUnits(v, USDT.decimals)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Parses a user-typed USDT amount; returns undefined for empty, zero, negative or malformed input. */
export function parseUsdt(s: string): bigint | undefined {
  if (!/^\d+(\.\d{0,6})?$/.test(s.trim())) return undefined;
  const v = parseUnits(s.trim(), USDT.decimals);
  return v > 0n ? v : undefined;
}

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
export const explorerTx = (h: Hex) => `${settlementChain.blockExplorers?.default.url ?? "https://explorer.testnet.whitechain.io"}/tx/${h}`;
export const explorerAddr = (a: Address) => `${settlementChain.blockExplorers?.default.url ?? "https://explorer.testnet.whitechain.io"}/address/${a}`;
/** "30 days", "1 day", or hours for periods that aren't whole days. */
export const period = (sec: bigint) => {
  const d = Number(sec) / 86400;
  return Number.isInteger(d) ? `${d} day${d === 1 ? "" : "s"}` : `${(Number(sec) / 3600).toFixed(1)} h`;
};
export const when = (sec: bigint | number) => new Date(Number(sec) * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

const ERRORS: Record<string, string> = {
  ZeroAddress: "An address is missing.",
  ZeroAmount: "Enter an amount above zero.",
  InsufficientBalance: "Your vault balance is too low for that.",
  InvalidLimit: "Both caps and the period must be above zero.",
  InvalidPayee: "That payee name is invalid.",
  NoGrant: "This agent has no grant to revoke.",
  UnknownPayee: "This payee isn't in your vault.",
  InvalidNominee: "Pick a nominee other than yourself and a delay above zero.",
  NotNominee: "There is no nominee set here, or this wallet isn't the nominee.",
  NomineeLocked: "The sender was active too recently; the nominee timer hasn't run out yet.",
  NotPending: "That payout is no longer pending.",
  SettleWindowOpen: "The provider still has time to settle this payout.",
};

/** Turns a viem/wallet error into one plain sentence, using the vault's custom error names. */
export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      if (name === "Error" && revert.reason) return revert.reason;
      return ERRORS[name] ?? (name ? `The vault rejected this: ${name}.` : revert.shortMessage);
    }
    if (/rejected|denied/i.test(e.shortMessage)) return "You cancelled this in your wallet.";
    if (/HTTP request failed|fetch failed|timed out/i.test(e.shortMessage)) return "Couldn't reach the network. Check your connection and try again.";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
