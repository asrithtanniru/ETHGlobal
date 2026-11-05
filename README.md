# Ghar

Pay your family's bills back home from stablecoins, only to accounts a licensed provider verified.

People working abroad are often paid in USDT or USDC, while the bills they cover at home (rent, school fees, clinic visits) are owed in local currency to bank accounts. Ghar lets a sender fund a vault once, set spending caps, and have an AI agent pay incoming bills, with three guarantees enforced onchain rather than by our servers:

- Money only goes to payee accounts a licensed payout provider has verified. A message saying "we changed our account, pay here" cannot redirect funds.
- Only bills signed by the payee's registered biller wallet are paid, and each bill expires after its due date so it cannot be paid twice.
- Every payment stays within the caps the sender set. A nominee can take over if the sender goes silent.

## How it works

1. The sender deposits USDT into the Ghar vault, sets caps and names a nominee.
2. Payees post bills to the Arkiv inbox from their own wallet.
3. The agent reads open bills for each payee.
4. The agent checks the payee's ENS name: the bill's creator must match the `biller` record, and the `payout` record must be set by the provider.
5. The agent calls `pay(bill)` on the vault, which checks caps and the biller before moving funds.
6. The vault sends USDT to the licensed payout provider, tagged with the order.
7. The provider pays the payee's bank account in local currency and writes a receipt to Arkiv.

## Components

| Component | Role | Network |
| --- | --- | --- |
| Whitechain vault | Holds USDT, enforces agent grants, payee caps and the nominee timer | Whitechain Sepolia (1874) |
| ENSv2 payee book | One subname per payee; only the provider's verifier can write `payout` and `biller` | Ethereum Sepolia |
| Arkiv inbox | Signed bills that expire after the due date, and receipts the family can read | Arkiv Rabdi (7794095) |
| Ghar agent | Reads bills, checks payees and calls the vault within its grant | Off-chain service |

## Repository layout

```
contracts/         Solidity vault and tests (Foundry)
packages/shared/   Chains, addresses and types used across the project
```

ENS, Arkiv, agent and web packages are added under `packages/` and `apps/` as they are built.

## Getting started

Requirements: Node.js 22.10 or later and [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
npm install
npm run typecheck
cd contracts && forge test
```

To deploy the vault, copy `contracts/.env.example` to `contracts/.env`, fill in `DEPLOYER_PRIVATE_KEY`, fund the wallet from the [Whitechain faucet](https://faucet.testnet.whitechain.io), then run:

```bash
npm run deploy:sepolia -w @ghar/contracts
```

## Networks and addresses

| Item | Value |
| --- | --- |
| Whitechain Sepolia RPC | `https://rpc.testnet.whitechain.io` |
| Whitechain explorer | https://explorer.testnet.whitechain.io |
| Test USDT (6 decimals) | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` |
| GharVault | [`0xe5AF8E81fe481bF15642f75BE929016411c41825`](https://explorer.testnet.whitechain.io/address/0xe5AF8E81fe481bF15642f75BE929016411c41825) |
| Arkiv Rabdi RPC | `https://rpc.rabdi.db-chain.testnet.arkiv.network` |
| ENSv2 Sepolia deployment | https://docs.ens.domains/learn/deployments |

## License

MIT
