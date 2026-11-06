"use client";

import { toHex, type Address, type Hex } from "viem";
import { useQuery } from "@tanstack/react-query";
import { signTypedData, switchChain } from "wagmi/actions";
import { settlementChain } from "@ghar/shared";
import { chainClient, wagmiConfig } from "@/lib/chain";
import { depositTypedData, RELAY_MIN, RELAY_WINDOW } from "@/lib/eip3009";
import type { TxState } from "./useTx";

/** Whether this vault and server can take deposits without gas. */
export function useGasless() {
  const q = useQuery({
    queryKey: ["relay"],
    staleTime: 60_000,
    queryFn: async () => ((await (await fetch("/api/relay/deposit")).json()) as { enabled: boolean }).enabled,
  });
  return q.data === true;
}

export const gaslessMin = RELAY_MIN;

/** The wallet signs a USDT authorization (no gas); Kin's relayer submits it to the vault and pays the gas. */
export async function depositWithoutGas(from: Address, value: bigint, set: (s: TxState) => void): Promise<Hex> {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + RELAY_WINDOW - 300);
  await switchChain(wagmiConfig, { chainId: settlementChain.id }).catch(() => undefined);
  set({ phase: "wallet", msg: "Sign the deposit in your wallet. It costs no gas" });
  const signature = await signTypedData(wagmiConfig, depositTypedData(from, value, validBefore, nonce));
  set({ phase: "pending", msg: "Kin is depositing it for you" });
  const r = await fetch("/api/relay/deposit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, value: value.toString(), validBefore: validBefore.toString(), nonce, signature }),
  });
  const j = (await r.json().catch(() => ({}))) as { hash?: Hex; error?: string };
  if (!r.ok || !j.hash) throw new Error(j.error ?? "The deposit didn't go through.");
  await chainClient.waitForTransactionReceipt({ hash: j.hash });
  return j.hash;
}
