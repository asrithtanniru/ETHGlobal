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
5. The agent calls `pay(bill)` on the vault, which checks caps and the biller, then locks the amount for the provider.
6. The licensed payout provider pays the payee's bank account in local currency and writes a receipt to Arkiv.
7. The provider calls `markPaid` to take the locked USDT, or `refund` to return it to the sender's balance. If the provider does nothing for a day, anyone can call `reclaim` to return it to the sender.

## Components

| Component | Role | Network |
| --- | --- | --- |
| Whitechain vault | Holds USDT, enforces agent grants, payee caps and the nominee timer | Whitechain Sepolia (1874) |
| ENSv2 payee book | One subname per payee; only the provider's verifier can write `payout` and `biller` | Ethereum Sepolia |
| Arkiv inbox | Signed bills that expire after the due date, and receipts the family can read | Arkiv Rabdi (7794095) |
| Ghar agent | Reads bills, checks payees and calls the vault within its grant (`apps/agent`) | Off-chain service |
| Settler | Runs the provider payout, settles on the vault and writes the receipt (`apps/agent`) | Off-chain service |
| Chat assistant | Ask in plain words ("pay my university fees"); Groq reads the vault, ENS and Arkiv, shows each payable bill as a card, and the sender approves it with a wallet signature. History is stored encrypted on Arkiv | Groq + Arkiv Rabdi |
| Merchant widget | `<script src=".../widget.js">` plus `<ghar-invoice>` (customer) and `<ghar-merchant>` (merchant: totals, refunds, receipts, CSV export) on any site, with `ghar:status` events. Demo: `examples/merchant-demo` (`npm run demo:merchant`, port 4000) | Any web page |
| Pay with Direct | Send money from your vault to a friend: they claim USD, EUR or GBP to their card or bank through Transak via a secret link tied to their email; the vault releases the USDT only after Transak pays (`/app/direct`, `/claim/…`) | Whitechain + Transak staging |
| Gasless deposits | The sender signs an EIP-3009 `ReceiveWithAuthorization`; Ghar's relayer calls `depositWithAuthorization` and pays the WBT | Whitechain Sepolia |
| Web app | Landing page, chat, vault screens, bill inbox, pay links and public receipts (`apps/web`) | Next.js |

## Repository layout

```
contracts/         Solidity vault and tests (Foundry)
packages/shared/   Chains, addresses and types used across the project
packages/ens/      Verified payee book on ENSv2
packages/arkiv/    Bill inbox and receipts on Arkiv
apps/agent/        Agent (bills to vault) and settler (payouts to receipts)
apps/web/          Landing page and app
arkiv/             Arkiv schema and notes
```

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

## Running the bill flow

Copy `packages/arkiv/.env.example` and `apps/agent/.env.example` to `.env` in the same folders and fill them in. Get a free Arkiv key at https://hub.arkiv.network/access-keys and test GLM at https://hub.arkiv.network/faucet.

```bash
npm run post-bill -w @ghar/arkiv -- rent 10 7 INV-001
npm run read-bills -w @ghar/arkiv -- rent
npm run agent -w @ghar/agent
npm run settler -w @ghar/agent
npm run dev -w @ghar/web
```

For the chat, copy `apps/web/.env.example` to `apps/web/.env.local` and fill in `GROQ_API_KEYS`, `CHAT_AGENT_PRIVATE_KEY` (grant it on the Agent page), `CHAT_ARKIV_PRIVATE_KEY` (fund it with test GLM) and `CHAT_SECRET`.

These commands use `gharfam.eth`. To work on another family, set `PAYEE_FAMILY` in the `.env` files. In the app, enter the family name on the Payees page.

## Live run

One bill went through the full flow on testnet on 6 Nov 2026, on GharVault v1 (before gasless deposits were added).

| Step | Proof |
| --- | --- |
| Biller posted `INV-001` for 10 USDT | Arkiv entity `0xad5df946b8edcf938067698e9c7e178a69b8ef62cb1b7b687094efc7aad47ec7`, [tx](https://rabdi.explorer.arkiv.network/tx/0x3f202d07eec2064b486c925144ef8a3f1f7bf9e99798318d220d8e84f40accac) |
| Another wallet posted a fake bill | Arkiv entity `0x28a46c77405b607f223caacb6f66605c93d06780be4ec947f4d9808b347fbcbb`, ignored as `wrong-biller` |
| Agent paid the real bill | [`pay` tx](https://explorer.testnet.whitechain.io/tx/0xbd8ad83d733b0d929bd4025910aaa51ea8782df892fdf8797578a0d90533dcb1) |
| Transak staging completed the order | Order `105818c8-3467-48f0-9ad2-14ec26579aa8`, [Sepolia deposit](https://sepolia.etherscan.io/tx/0x535b326e9477f4116749a8b53e80c4872d8227743d92ee384e2a69d9a100acb5) |
| Provider settled on the vault | [`markPaid` tx](https://explorer.testnet.whitechain.io/tx/0xe73008b5c25af878cf76196e0cb1fe7fd77ed761422b4f0f8e5ef886df3b82d5) |
| Provider wrote the receipt | Arkiv entity `0xc6756d1d308588401a68a1949c9619277da71f42dcc118160193240da6578b44` |

Transak staging sells a fixed amount of Sepolia ETH, so the delivered 39.84 USD doesn't equal the 10 USDT bill. A production provider would be funded from the USDT released by `markPaid`.

**Arkiv writer wallets:** biller `0x14ce36ac40976c12b726AF5af5bfFFdAac14E0fd`, provider `0x19f4c0fcA7046cC29eF23139b30572F09a36e5f6`, fake-bill demo `0x294dbec3E3b03c3195332f3308DA36ab83f4D44c`.

**A query to run** (lists every bill under a payee and whether the agent accepts it):

```bash
npm run read-bills -w @ghar/arkiv -- rent
```

### Gasless deposit on GharVault v2

| Step | Proof |
| --- | --- |
| v2 deployed with `depositWithAuthorization` | [`0x8ce0…1b49`](https://explorer.testnet.whitechain.io/tx/0x8ce055664ff5c5a2b90e8ad1f7748d62d4730076e8e80f663507db1ee54a1b49) |
| Sender signed an EIP-3009 `ReceiveWithAuthorization` for 20 USDT; Ghar's relayer `0x5051…db65` submitted it | [`0xfd60…30ee`](https://explorer.testnet.whitechain.io/tx/0xfd600b8d473bcc01b3f2b6c9e3f0d5bf28549ae83474f583677797fb77ab30ee). The sender's WBT balance was unchanged before and after |
| Second gasless deposit, 2 USDT: the relayer paid 0.00051 WBT (101,952 gas); the sender's WBT changed by 0 | [`0xb2fe…a5dd`](https://explorer.testnet.whitechain.io/tx/0xb2fe3900b5a8658111131a62cf3076b1d3d723871efa1f4211d4e508705aa5dd) |

## Networks and addresses

| Item | Value |
| --- | --- |
| Whitechain Sepolia RPC | `https://rpc.testnet.whitechain.io` |
| Whitechain explorer | https://explorer.testnet.whitechain.io |
| Test USDT (6 decimals) | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` |
| GharVault (v2, with gasless deposits, verified) | [`0x707447BCDD25651B0313c3542BB1a17fF2e1d29E`](https://explorer.testnet.whitechain.io/address/0x707447BCDD25651B0313c3542BB1a17fF2e1d29E) |
| GharVault v1 (the live run below; superseded) | [`0xA855E5b5152F7C7c824dc5c8EF034696a65587Ae`](https://explorer.testnet.whitechain.io/address/0xA855E5b5152F7C7c824dc5c8EF034696a65587Ae) |
| Arkiv Rabdi RPC | `https://rpc.rabdi.db-chain.testnet.arkiv.network` |
| ENSv2 Sepolia deployment | https://docs.ens.domains/learn/deployments |

## License

MIT
