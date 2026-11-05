// Reads a payee's records the way the agent will: through the ENSv2 Universal Resolver.
// Usage: npm run read -w @ghar/ens -- <label>
import { normalize } from "viem/ens";
import { ENS_V2_SEPOLIA, PAYEE_BOOK_PARENT } from "@ghar/shared";
import { publicClient } from "./client.ts";

const label = process.argv[2];
if (!label) throw new Error("usage: read <label>");
const name = normalize(`${label}.${PAYEE_BOOK_PARENT}`);

for (const key of ["payout", "biller"]) {
  // viem's Sepolia config still points at the ENS v1 Universal Resolver, so pass v2 explicitly.
  const value = await publicClient.getEnsText({
    name, key, universalResolverAddress: ENS_V2_SEPOLIA.universalResolver,
  });
  console.log(`${name} ${key} = ${value ?? "(not set)"}`);
}
