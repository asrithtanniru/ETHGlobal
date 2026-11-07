# Whitechain feedback

Notes from building Kin on Whitechain Sepolia (chain 1874) at ETHGlobal Mumbai.

## What worked well

- `whitechainSepolia` ships in `viem/chains`, so no custom chain setup was needed.
- The test USDT supports EIP-3009. That let us build gasless deposits: the sender signs, and our relayer calls `depositWithAuthorization` and pays the WBT.
- The Blockscout explorer and its API made proofs easy. A `markPaid` transaction shows the USDT moving from the vault to the provider in its token transfers.

## What got in our way

### `eth_getLogs` is capped at 10,000 blocks

- **Expected:** reading a contract's events from its deploy block to the latest block in one call.
- **What happened:** the RPC rejects ranges over 10,000 blocks.
- **Reproduce:** call `eth_getLogs` on `https://rpc.testnet.whitechain.io` with a range wider than 10,000 blocks.
- **Workaround:** every event read is chunked (`apps/web/lib/chain.ts`, `apps/agent/src/settler.ts`). Each page load makes many requests as the chain grows.
- **Suggestion:** document the limit next to the RPC URL, or offer an indexed events endpoint.

### No direct route from Whitechain to fiat

- **Expected:** an off-ramp that accepts USDT on Whitechain.
- **What happened:** the off-ramps we used don't list Whitechain. Transak's listed networks and P2P.me's Base deployment don't include it.
- **Workaround:** the provider pays the payee from its own float on another chain, and the vault repays it in USDT on Whitechain through `markPaid`.
- **Suggestion:** an off-ramp partner or a documented bridge for USDT would make a merchant flow much simpler.

## What would help next

- A published list of payment and off-ramp partners that support Whitechain.
- A reference relayer showing how to fund it with WBT and limit abuse.
