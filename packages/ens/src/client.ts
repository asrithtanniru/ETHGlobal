import { createPublicClient, http, parseAbi } from "viem";
import { ensChain } from "@ghar/shared";

export const transport = http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com");
export const publicClient = createPublicClient({ chain: ensChain, transport });

/** PermissionedResolver role that allows writing text records. */
export const ROLE_SET_TEXT = 1n << 4n;

export const resolverAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)",
  "function setText(bytes name, string key, string value)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
]);

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
