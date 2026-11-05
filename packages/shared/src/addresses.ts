import type { Address } from "viem";

/** Test USDT on Whitechain Sepolia. 6 decimals, supports EIP-3009 transferWithAuthorization. */
export const USDT = {
  address: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
  decimals: 6,
  symbol: "USDT",
} as const satisfies { address: Address; decimals: number; symbol: string };

/** ENSv2 deployment on Ethereum Sepolia, from docs.ens.domains/learn/deployments. */
export const ENS_V2_SEPOLIA = {
  rootRegistry: "0xb458d6a3a77919449d03e7a6903c26827c1ec43f",
  ethRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
  ethRegistrar: "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3",
  universalResolver: "0x24e1d8e068620b647ca097f961a61055f4f42d72",
  verifiableFactory: "0xda70306c98e97ece36f997a21368e53298572991",
  permissionedResolverImpl: "0x115eb53f0c60696633855f90b138178fb40b2b2c",
} as const satisfies Record<string, Address>;
