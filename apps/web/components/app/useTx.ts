"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { useWriteContract } from "wagmi";
import { chainClient, explain } from "@/lib/chain";

type WriteArgs = Parameters<ReturnType<typeof useWriteContract>["mutateAsync"]>[0];
export type TxState = { phase: "idle" | "wallet" | "pending" | "done" | "error"; msg?: string; hash?: Hex };

/**
 * Simulates, sends and waits for one or more vault/USDT writes in order. Each step is simulated
 * against the chain first so custom errors show before the wallet prompt.
 */
export function useTx(onDone?: () => void) {
  const { mutateAsync } = useWriteContract();
  const [state, setState] = useState<TxState>({ phase: "idle" });
  async function run(steps: WriteArgs[], okMsg: string) {
    try {
      let hash: Hex | undefined;
      for (const step of steps) {
        await chainClient.simulateContract({ ...(step as object), account: (step as { account?: Hex }).account } as never);
        setState({ phase: "wallet", msg: "Confirm in your wallet" });
        hash = await mutateAsync(step);
        setState({ phase: "pending", msg: "Waiting for Whitechain", hash });
        const r = await chainClient.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error("The transaction reverted.");
      }
      setState({ phase: "done", msg: okMsg, hash });
      onDone?.();
    } catch (e) {
      setState({ phase: "error", msg: explain(e) });
    }
  }
  return { state, run, busy: state.phase === "wallet" || state.phase === "pending", reset: () => setState({ phase: "idle" }) };
}
