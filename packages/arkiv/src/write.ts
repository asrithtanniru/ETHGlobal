// Guarded one-shot Arkiv writes, adapted from Arkiv's maintained adapter (guides/quickstart).
// One Create per adapter, explicit nonce/gas/gasPrice, hard fee budget, public journal, no retries:
// after an uncertain outcome the caller reconciles from the journal instead of writing again.
import { appendFileSync } from "node:fs";
import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { bytes, str, u256, u64, type Schema } from "@arkiv-network/sdk/schema";
import { createPublicClient, custom, decodeFunctionData, getAddress, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { billEntity, billTypedData, type BillInput } from "./bill.ts";
import { GharBill, GharChat, GharReceipt } from "./schema.ts";

const CHAIN_ID = 7794095;
const REGISTRY = "0x4400000000000000000000000000000000000044";
const executeAbi = parseAbi(["function execute((uint8 operation, bytes operationData)[] ops) external returns (bytes32[] keys)"]);
const readMethods = new Set(["eth_blockNumber", "eth_chainId", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber"]);
const fail = (message: string): never => { throw new Error(message); };

export interface WriterConfig {
  accessKey: string;
  /** Local signing key. Writes also need ARKIV_ALLOW_WRITE=1. */
  privateKey: Hex;
  /** Most this one write may cost, in wei of Rabdi's gas token. */
  maxCostWei: bigint;
  /** Local file that records every public transaction hash before and after sending. */
  journal: string;
}

type Tx = { from: Address; to: Address; data: Hex; value: bigint; chainId: number; type: "legacy"; gas: bigint; gasPrice: bigint; nonce: number };

async function guardedCreate<S extends Schema>(cfg: WriterConfig, schema: S, values: never, options: never) {
  if (process.env.ARKIV_ALLOW_WRITE !== "1") fail("Arkiv writes are off: set ARKIV_ALLOW_WRITE=1 for this run");
  if (cfg.maxCostWei <= 0n) fail("A positive fee budget is required");
  const chain = rabdi({ accessKey: cfg.accessKey });
  const pub = createPublicClient({ chain, transport: http(undefined, { timeout: 15_000, retryCount: 0 }) });
  const account = privateKeyToAccount(cfg.privateKey);
  const address = getAddress(account.address);
  const note = (entry: object) => appendFileSync(cfg.journal, JSON.stringify({ at: new Date().toISOString(), from: address, ...entry }) + "\n");
  const state = { attempted: false, hash: null as Hex | null, phase: "ready" };
  let explicit: { nonce: number; gas: bigint; gasPrice: bigint };
  let approved: Tx;

  const client = createWalletClient({
    chain,
    account: address,
    pollingInterval: 1000,
    transport: custom({
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        if (readMethods.has(method)) return pub.request({ method, params } as never);
        if (method !== "eth_sendTransaction" || state.attempted) fail("Only one create submission is permitted; do not retry");
        state.attempted = true;
        state.phase = "preflight";
        const input = (params as [{ from: Address; to: Address; data: Hex; gas: Hex; gasPrice: Hex; nonce: Hex }])[0];
        if (getAddress(input.from) !== address || input.to?.toLowerCase() !== REGISTRY
          || BigInt(input.gas ?? 0) !== explicit.gas || BigInt(input.gasPrice ?? 0) !== explicit.gasPrice || Number(input.nonce) !== explicit.nonce) {
          fail("Unexpected transaction fields");
        }
        const decoded = decodeFunctionData({ abi: executeAbi, data: input.data });
        if (decoded.args[0].length !== 1 || decoded.args[0][0]!.operation !== 1) fail("Exactly one Create operation is required");
        if ((await pub.getChainId()) !== CHAIN_ID) fail("Expected Rabdi RPC");

        const call = { account: address, to: REGISTRY as Address, data: input.data, value: 0n };
        const estimate = await pub.estimateGas({ ...call, blockTag: "latest" } as never);
        const floor = 1_000_000n;
        const gas = estimate * 2n > floor ? estimate * 2n : floor;
        const head = await pub.getBlock({ blockTag: "latest", includeTransactions: false });
        if (gas * 2n > head.gasLimit) fail("Gas exceeds half the current block limit");
        const { gasPrice, nonce } = explicit;
        const maximum = gas * gasPrice;
        if (maximum > cfg.maxCostWei) fail("Write exceeds the fee budget");
        if ((await pub.getBalance({ address, blockTag: "latest" })) < maximum) fail("Wallet balance is too low; fund it at hub.arkiv.network/faucet");
        approved = { from: address, to: REGISTRY as Address, data: input.data, value: 0n, chainId: CHAIN_ID, type: "legacy", gas, gasPrice, nonce };

        if ((await pub.getTransactionCount({ address, blockTag: "latest" })) !== nonce || (await pub.getGasPrice()) !== gasPrice) {
          fail("Nonce or gas price changed; a new attempt is needed");
        }
        const { from: _from, ...unsigned } = approved;
        const serializedTransaction = await account.signTransaction(unsigned);
        const expected = keccak256(serializedTransaction);
        note({ event: "signed", hash: expected, nonce, maximum: maximum.toString() });
        state.phase = "submission_unknown";
        const hash = await pub.sendRawTransaction({ serializedTransaction }).catch(() => fail("Submission is uncertain; reconcile from the journal before any new write"));
        if (hash.toLowerCase() !== expected.toLowerCase()) fail("RPC returned a different transaction hash");
        state.hash = hash;
        state.phase = "submitted";
        note({ event: "submitted", hash });
        return hash;
      },
    }, { retryCount: 0 }),
  });

  explicit = { nonce: await pub.getTransactionCount({ address, blockTag: "latest" }), gas: 1_000_000n, gasPrice: await pub.getGasPrice() };
  try {
    const result = await client.createEntity(schema, values, options, explicit as never);
    const mined = await pub.getTransactionReceipt({ hash: state.hash! });
    if (mined.status !== "success") fail("Create reverted");
    note({ event: "confirmed", hash: state.hash, entityKey: result.entityKey });
    return result;
  } catch {
    // Raw errors can carry the keyed RPC URL, so only the phase and hash leave this function.
    note({ event: "unverified", phase: state.phase, hash: state.hash });
    throw new Error(`Arkiv create not verified (${state.phase}); check ${cfg.journal} and do not resend automatically`);
  }
}

/** Signs a bill with the biller key and posts it from that same wallet, so $creator is the biller. */
export async function postBill(cfg: WriterConfig, bill: BillInput & { currency: string; note?: string }) {
  const account = privateKeyToAccount(cfg.privateKey);
  const { values, options } = billEntity(bill, await account.signTypedData(billTypedData(bill)));
  return guardedCreate(cfg, GharBill, values as never, options as never);
}

export interface ReceiptInput {
  digest: Hex;
  billKey: Hex;
  payee: string;
  status: "paid" | "refunded";
  settlementTx: Hex;
  providerRef: string;
  fiat?: string;
  payoutRef?: string;
}

/** Provider's receipt: readonly, and kept for the longest lifetime Rabdi allows (about six months). */
export function postReceipt(cfg: WriterConfig, r: ReceiptInput) {
  const values = {
    digest: str(r.digest), billKey: str(r.billKey), payee: str(r.payee), status: str(r.status),
    settlementTx: str(r.settlementTx), providerRef: str(r.providerRef.slice(0, 120)),
    ...(r.fiat ? { fiat: str(r.fiat) } : {}),
    ...(r.payoutRef ? { payoutRef: str(r.payoutRef.slice(0, 120)) } : {}),
  };
  return guardedCreate(cfg, GharReceipt, values as never, { expiration: ExpirationTime.max(), flags: { readonly: true } } as never);
}

export interface ChatTurnInput {
  owner: Address;
  thread: string;
  seq: number;
  at: number;
  /** Already encrypted by the caller. */
  body: Hex;
}

/** One encrypted chat exchange: readonly, kept for the longest lifetime Rabdi allows. */
export function postChatTurn(cfg: WriterConfig, t: ChatTurnInput) {
  const values = { owner: str(t.owner.toLowerCase()), thread: str(t.thread), seq: u64(t.seq), at: u64(t.at), body: bytes(t.body) };
  return guardedCreate(cfg, GharChat, values as never, { expiration: ExpirationTime.max(), flags: { readonly: true } } as never);
}
