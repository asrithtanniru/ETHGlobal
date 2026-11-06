import type { Address } from "viem";

/** Test USDT on Whitechain Sepolia. 6 decimals, supports EIP-3009 transferWithAuthorization. */
export const USDT = {
  address: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
  decimals: 6,
  symbol: "USDT",
} as const satisfies { address: Address; decimals: number; symbol: string };

/** GharVault on Whitechain Sepolia. */
export const GHAR_VAULT = "0x707447BCDD25651B0313c3542BB1a17fF2e1d29E" as const satisfies Address;

/** Block GharVault was deployed in. Event queries start here. */
export const GHAR_VAULT_DEPLOY_BLOCK = 12_375_263n;

/** ENSv2 deployment on Ethereum Sepolia, from docs.ens.domains/learn/deployments. */
export const ENS_V2_SEPOLIA = {
  rootRegistry: "0xb458d6a3a77919449d03e7a6903c26827c1ec43f",
  ethRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
  ethRegistrar: "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3",
  universalResolver: "0x24e1d8e068620b647ca097f961a61055f4f42d72",
  verifiableFactory: "0xda70306c98e97ece36f997a21368e53298572991",
  permissionedResolverImpl: "0x115eb53f0c60696633855f90b138178fb40b2b2c",
  /** Mintable test USDC the Sepolia ETHRegistrar accepts as payment. */
  mockUsdc: "0x240b0316df57887dbbe58b586508b19e633a14aa",
} as const satisfies Record<string, Address>;

/** Parent ENS name on Sepolia whose subnames are the verified payees, e.g. rent.gharfam.eth. */
export const PAYEE_BOOK_PARENT = "gharfam.eth";

/** PermissionedResolver serving the payee book. Only the provider's verifier can set text. */
export const PAYEE_BOOK_RESOLVER = "0x9B32621a0AC619EfE148ece5F40674b7474C9a58" as const satisfies Address;
