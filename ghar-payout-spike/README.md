# Ghar payout spike: USDT on Whitechain → INR via Onramp sandbox

```
sender ──approve + requestPayout(10 USDT, "rent")──▶ GharPayout (Whitechain Sepolia)
                                                       │ emits PayoutRequested
                                                       ▼
                                             adapter (Node, watches events)
                                                       │ quote → create sell order → walk sandbox statuses
                                                       ▼
                                             Onramp sandbox (api-test.onramp.money)
                                                       │ INR "sent to bank" (status 14) or failed (-1)
                                                       ▼
                         adapter calls markPaid (USDT → treasury)  or  refund (USDT → sender)
```

Without Onramp keys the adapter runs in **MOCK mode** (same flow, fake quote). Add keys later; nothing else changes.

## 0. One-time setup
- Install Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- Two throwaway wallets: **SENDER** (pays) and **OPERATOR** (the adapter).
- Faucet: claim WBT (gas) for both at https://faucet.testnet.whitechain.io (GitHub account older than 30 days).
- Get test USDT for SENDER: swap some WBT on YetiTrade (QR on the Whitechain flyer).
  Test USDT: `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (6 decimals).

```bash
export RPC=https://rpc.testnet.whitechain.io
export USDT=0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7
export SENDER_PK=0x...      # sender key
export OPERATOR_PK=0x...    # adapter key
export OPERATOR_ADDRESS=$(cast wallet address $OPERATOR_PK)
```

## 1. Deploy and verify the contract
```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge script script/Deploy.s.sol:Deploy --rpc-url whitechain_sepolia --private-key $SENDER_PK --broadcast
export G=0x...   # "GharPayout deployed at" from the output

forge verify-contract $G src/GharPayout.sol:GharPayout \
  --rpc-url whitechain_sepolia --verifier blockscout \
  --verifier-url https://explorer.testnet.whitechain.io/api/ \
  --constructor-args $(cast abi-encode "c(address,address,address)" $USDT $OPERATOR_ADDRESS $OPERATOR_ADDRESS)
```
(Treasury defaults to the operator address. Set `TREASURY_ADDRESS` before deploying to change it.)

## 2. Start the adapter
```bash
cd ../adapter
npm install
cp .env.example .env    # fill GHAR_PAYOUT_ADDRESS=$G and OPERATOR_PRIVATE_KEY
node setup-payee.mjs rent    # MOCK: saves a fake payee. With keys: see step 4
npm start
```

## 3. Trigger a payout (second terminal)
```bash
cast send $USDT "approve(address,uint256)" $G 10000000 --rpc-url $RPC --private-key $SENDER_PK
cast send $G "requestPayout(uint256,bytes32)" 10000000 $(cast format-bytes32-string rent) --rpc-url $RPC --private-key $SENDER_PK
```
`10000000` = 10 USDT (6 decimals). The adapter log prints the quote, each provider status and two explorer links:
your `requestPayout` tx and the adapter's `markPaid` tx.

**Refund demo:** restart the adapter with `SIMULATE_FAILURE=1 npm start` and trigger again.
The provider order fails (status -1) and the adapter calls `refund`, so the USDT returns to the sender.

## 4. Switching from MOCK to the real Onramp sandbox
1. Get white-label **sandbox** API key + secret from Onramp (onramp.money/business → Integrate Now, or ask their team).
2. Put them in `.env` (`ONRAMP_API_KEY`, `ONRAMP_API_SECRET`).
3. Register the payee once:
   `node setup-payee.mjs rent +91-9876543210 rent@example.com <bankAccount> <IFSC>`
   It prints a KYC link: open it, enter OTP `123456` (sandbox), press Enter. The script marks KYC complete and adds the bank account.
   Onramp declines payouts if the bank-account name doesn't match the KYC name.
4. `npm start` and trigger again. Quotes now come from Onramp, including its fee and 1% TDS breakdown.

## 5. Transak provider (real sandbox order, testnet deposit, real statuses)
Fiat is USD in Transak staging (no INR there). Everything else is real.

`.env`:
```
PROVIDER=transak
TRANSAK_API_KEY=...            # dashboard -> Staging -> Developers
TRANSAK_API_SECRET=...
SEPOLIA_PRIVATE_KEY=0x...      # wallet with Sepolia ETH (at least 0.02 per payout + gas)
TRANSAK_SELL_ETH=0.02
TRANSAK_EMAIL=                 # set to you+failed@gmail.com to demo the refund path
```
Run `npm start`, trigger `requestPayout` (step 3). For each payout the adapter:
1. creates a Transak SELL widget URL tagged `partnerOrderId=ghar-<contract>-<id>-<ts>` and prints it,
2. **you open it within 5 min and confirm** (already-KYC'd test user; payout card 4024 7644 4997 1519, 10/33, CVV 000),
3. the adapter sees the order, **auto-sends the Sepolia ETH** to Transak's deposit address (do NOT send it yourself),
4. polls until `COMPLETED` -> `markPaid` on Whitechain, or `FAILED/REFUNDED/EXPIRED` -> `refund`.

Log shows: Whitechain request tx -> Transak order id -> Sepolia deposit tx -> statuses -> Whitechain markPaid/refund tx.
The order also appears in the Transak staging dashboard.

## Files
- `contracts/src/GharPayout.sol`: escrow with `requestPayout`, `markPaid`, `refund`
- `contracts/test/MockUSDT.sol`: USDT-like token for local testing on anvil
- `adapter/transak.mjs`: Transak staging client (access token, widget URL, order polling, Sepolia deposit)
- `adapter/onramp.mjs`: Onramp white-label client (HMAC-SHA512 signing, sandbox status helpers, MOCK fallback)
- `adapter/index.mjs`: event listener → provider → `markPaid`/`refund`
- `adapter/setup-payee.mjs`: one-time payee KYC + bank account registration

## Notes
- Sandbox only. No real funds move on either side.
- Onramp's USDT networks are BEP20/Polygon/ERC20/TRC20, not Whitechain. In the sandbox no deposit is needed;
  the adapter moves the order through statuses 10 → 12 → 13 → 14 with the sandbox-only endpoint.
- Whitechain public RPC is rate limited to 50 req/s per IP; the adapter polls every 2s.
