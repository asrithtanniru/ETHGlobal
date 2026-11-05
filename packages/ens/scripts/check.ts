import { createPublicClient, formatEther, http, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";

// Canonical values live in packages/shared/src/addresses.ts; duplicated here
// because @ghar/shared ships TS source only (no runtime build).
const ETH_REGISTRAR = "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3" as const;

const rpcUrl = process.env.SEPOLIA_RPC_URL;
if (!rpcUrl) throw new Error("set SEPOLIA_RPC_URL");
const parent = process.argv[2] ?? "ghar-demo-ram-2026";
const wallets = process.argv[3]
  ? process.argv[3].split(",")
  : (["0xcCa1595278f5B8CFdA0380943Af9b56493fA14dE", "0x289824eB464c2531d24Bc9064f47B90711ebD4aB"] as const);

const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
console.log("block:", await client.getBlockNumber());
for (const address of wallets) {
  console.log(address, formatEther(await client.getBalance({ address: address as `0x${string}` })), "ETH");
}
const available = await client.readContract({
  address: ETH_REGISTRAR,
  abi: parseAbi(["function isAvailable(string label) returns (bool)"]),
  functionName: "isAvailable",
  args: [parent],
});
console.log(`isAvailable(${parent}):`, available);
// Docs readiness probe: canonical integration name, proves the UR path via viem.
const probe = await client
  .getEnsText({ name: normalize("ur.integration-tests.eth"), key: "description" })
  .catch((e: unknown) => `ERR ${(e as Error).message.slice(0, 100)}`);
console.log("ur.integration-tests.eth description:", probe);
