import { sepolia, whitechainSepolia } from "viem/chains";

/** Whitechain Sepolia (chain 1874): holds the vault and settles every payment in USDT. */
export const settlementChain = whitechainSepolia;

/** Ethereum Sepolia: hosts the ENSv2 contracts that make up the verified payee book. */
export const ensChain = sepolia;

/** Arkiv Rabdi testnet: the bill inbox and receipts. The Arkiv SDK ships its own chain object. */
export const arkivNetwork = {
  id: 7_794_095,
  name: "Arkiv Rabdi",
  rpcUrl: "https://rpc.rabdi.db-chain.testnet.arkiv.network",
  explorerUrl: "https://rabdi.explorer.arkiv.network",
} as const;
