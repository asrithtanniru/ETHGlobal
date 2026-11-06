// Server-only reads of the Arkiv inbox. The access key never reaches the browser.
import "server-only";
import type { Address } from "viem";
import { GHAR_VAULT, gharVaultAbi } from "@ghar/shared";
import { arkivClient } from "@ghar/arkiv";
import { chainClient } from "./chain";

export const arkiv = () => arkivClient(process.env.ARKIV_ACCESS_KEY ?? "");

/** Receipts are trusted only from the vault's provider wallet, read from the contract itself. */
export const providerWallet = () =>
  chainClient.readContract({ address: GHAR_VAULT, abi: gharVaultAbi, functionName: "provider" }) as Promise<Address>;

/** Bigints as strings for JSON. */
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
