import {
  BaseError,
  ContractFunctionRevertedError,
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { GHAR_VAULT, GHAR_VAULT_DEPLOY_BLOCK, gharVaultAbi, type settlementChain } from "@ghar/shared";
import { getVerifiedPayee } from "@ghar/ens";
import { namehash } from "viem/ens";
import type { PayeeBook, Vault } from "./types.ts";

const vaultContract = { address: GHAR_VAULT, abi: gharVaultAbi } as const;

export function ensPayeeBook(client: PublicClient): PayeeBook {
  return { read: (name) => getVerifiedPayee(client, name) };
}

/** The Whitechain RPC caps log queries at this many blocks. */
const LOG_RANGE = 10_000n;

/** Amounts this sender has sent to a payee, oldest first. Feeds the reviewer. */
export function vaultPastAmounts(client: PublicClient<Transport, typeof settlementChain>, sender: Address) {
  return async (payee: string): Promise<bigint[]> => {
    const head = await client.getBlockNumber();
    const amounts: bigint[] = [];
    for (let from = GHAR_VAULT_DEPLOY_BLOCK; from <= head; from += LOG_RANGE) {
      const to = from + LOG_RANGE - 1n < head ? from + LOG_RANGE - 1n : head;
      const logs = await client.getContractEvents({
        ...vaultContract,
        eventName: "PayoutRequested",
        args: { sender, payee: namehash(payee) },
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) if (log.args.amount !== undefined) amounts.push(log.args.amount);
    }
    return amounts;
  };
}

/** Turns a revert into the vault's error name, e.g. "InvalidSignature". */
function revertName(e: unknown): Error {
  const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
  const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
  return name ? new Error(`vault-revert: ${name}`) : (e as Error);
}

export function whitechainVault(
  client: PublicClient<Transport, typeof settlementChain>,
  wallet: WalletClient<Transport, Chain, Account>,
): Vault {
  const agent: Address = wallet.account.address;

  const simulate = (sender: Address, bill: Parameters<Vault["pay"]>[1], signature: `0x${string}`) =>
    client
      .simulateContract({ ...vaultContract, account: wallet.account, functionName: "pay", args: [sender, bill, signature] })
      .catch((e: unknown) => {
        throw revertName(e);
      });

  return {
    async readFacts(sender, bill) {
      const digest = await client.readContract({ ...vaultContract, functionName: "billDigest", args: [bill] });
      const [payout, vaultBiller, balance, availableToAgent, availableToPayee] = await Promise.all([
        client.readContract({ ...vaultContract, functionName: "payoutOf", args: [digest] }),
        client.readContract({ ...vaultContract, functionName: "billerOf", args: [sender, bill.payee] }),
        client.readContract({ ...vaultContract, functionName: "balanceOf", args: [sender] }),
        client.readContract({ ...vaultContract, functionName: "availableToAgent", args: [sender, agent] }),
        client.readContract({ ...vaultContract, functionName: "availableToPayee", args: [sender, bill.payee] }),
      ]);
      return { payoutStatus: payout[2], vaultBiller, balance, availableToAgent, availableToPayee };
    },

    async simulatePay(sender, bill, signature) {
      await simulate(sender, bill, signature);
    },

    async pay(sender, bill, signature) {
      const { request } = await simulate(sender, bill, signature);
      const hash = await wallet.writeContract(request);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`pay reverted: ${hash}`);
      return hash;
    },
  };
}
