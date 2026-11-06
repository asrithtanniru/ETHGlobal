# Ghar payout module: integration guide

This module is the **last step of a Ghar payment**: getting money from the sender's stablecoins on Whitechain into the payee's hands as fiat, through a payout provider.

It is **built and tested end to end** on Whitechain Sepolia with Transak's staging environment (see "Proof it works"). Integrate it into the main Ghar codebase; do not rewrite it.

---

## 1. Roles in Ghar terms

| Role | Who in real life | In this module | What they do |
|---|---|---|---|
| **Sender** | The person working abroad, paid in USDT/USDC, paying family bills back home | A wallet on Whitechain holding USDT | Funds the payment. Calls `requestPayout` directly in this spike; in full Ghar the **vault's `pay()`** does it after the agent checks the bill, caps and ENS payee. **The sender never sees Transak and never enters card details.** |
| **Ghar agent** | The AI agent that pays verified bills within caps | Not in this module | Decides *when* to pay (bill on Arkiv, payee in ENS, within caps), then calls the vault |
| **Ghar vault / GharPayout contract** | Smart contract on Whitechain | `contracts/src/GharPayout.sol` | Locks the USDT, emits `PayoutRequested`, and later either releases the USDT to the provider (`markPaid`) or returns it to the sender (`refund`) |
| **Payout adapter (operator)** | Ghar's backend service | `adapter/` (Node) | Watches Whitechain, creates the payout order with the provider, funds it, waits for the result, settles on Whitechain. Its key is the only one allowed to call `markPaid`/`refund` |
| **Payout provider** | A licensed off-ramp (Transak, Onramp.money…) | **Transak staging** | Verifies the payee once (KYC), receives crypto, pays fiat to the payee's verified account |
| **Provider treasury** | The provider's crypto liquidity | The wallet in `SEPOLIA_PRIVATE_KEY` + the `treasury` address in the contract | Pays the provider in crypto for each order; is repaid with the sender's USDT through `markPaid` |
| **Payee (receiver)** | Landlord, clinic, school, family member back home | **The Transak test user (Doe Jane) and their payout card ending 1519** | Is KYC'd by the provider and **owns the payout card/bank account**. **The payee is the one who enters card details** in the Transak widget |

### Who enters card details?

**Only the payee**, inside Transak's own widget. Never the sender, never Ghar.

- **Production:** the payee completes KYC with the provider **once**, adding their bank account or card. That is Ghar's "payee verified once by a licensed provider" step, and the provider's account reference is what ENS stores as the payee's `payout` record.
- **Demo (Transak staging):** Transak requires a confirmation in its widget **for every order**. So for each payout, whoever plays the **payee** opens the widget link the adapter prints and confirms with the staging test card. Narrate it as "the payee confirms the payout to their verified card".

### Why USDT on one side and ETH on the other?

This is the **provider-float model** used by real off-ramps:
1. The sender's **USDT is locked on Whitechain** when the payment is requested.
2. The provider pays the payee **from its own liquidity**. Here that's 0.02 Sepolia ETH sold through Transak, because Transak staging only reconciles native testnet tokens.
3. When the fiat is delivered, `markPaid` **releases the sender's USDT to the provider's treasury**, repaying it.

The two legs are linked by the order ID: `partnerOrderId = ghar-<contract>-<payoutId>-<timestamp>` on Transak, and the Transak order ID is written back on Whitechain in `PayoutCompleted`.

---

## 2. End-to-end flow

```
SENDER (abroad)                 WHITECHAIN                     ADAPTER (Ghar backend)            TRANSAK (provider)                PAYEE (back home)
     |                               |                                  |                               |                               |
 1.  |-- approve USDT -------------->|                                  |                               |                               |
 2.  |-- requestPayout(amt,"rent") ->| lock USDT                        |                               |                               |
     |   (in Ghar: vault.pay())      | emit PayoutRequested(id,..) ---->|                               |                               |
 3.  |                               |                                  |-- create SELL order --------->|                               |
     |                               |                                  |   (partnerOrderId=ghar-..-id) |                               |
     |                               |                                  |-- prints widget link ------------------------------------------>|
 4.  |                               |                                  |                               |<-- payee confirms, enters ----|
     |                               |                                  |                               |    payout card (KYC'd once)   |
 5.  |                               |                                  |<-- order AWAITING_PAYMENT ----|  shows deposit address        |
 6.  |                               |                                  |-- sends 0.02 Sepolia ETH ---->|  (provider float)             |
 7.  |                               |                                  |<-- PENDING_DELIVERY ----------|  crypto received + matched    |
 8.  |                               |                                  |<-- COMPLETED -----------------|-- fiat paid to card ••1519 -->|
 9.  |                               |<-- markPaid(id, orderId, cents) -|                               |                               |
     |                               | USDT -> provider treasury        |                               |                               |
     |                               | emit PayoutCompleted             |                               |                               |
 FAIL|<-- USDT back -----------------|<-- refund(id, reason) -----------| if FAILED/REFUNDED/EXPIRED    |                               |
```

The steps:
1. **Sender approves** the contract to pull USDT.
2. **Sender (or Ghar vault) requests the payout.** USDT is locked; `PayoutRequested(id, sender, amount, payeeRef)` is emitted. `payeeRef` is a bytes32 label such as `"rent"`. In full Ghar it maps to the ENS payee (`rent.you.eth`).
3. **Adapter creates a Transak SELL order** for that payout and prints a one-time widget link (valid 5 minutes).
4. **Payee opens the link and confirms** with their payout card. The card is what the payee owns, and money lands there.
5. **Transak shows a deposit address** (`AWAITING_PAYMENT_FROM_USER`).
6. **Adapter automatically sends 0.02 Sepolia ETH** from the provider treasury wallet. **Nobody sends it by hand.**
7. Transak receives and matches the deposit (`PENDING_DELIVERY_FROM_TRANSAK`).
8. Transak **pays the payee** (`COMPLETED`).
9. **Adapter calls `markPaid`** on Whitechain: the USDT goes to the provider treasury, and `PayoutCompleted(id, transakOrderId, fiatCents)` is emitted.
   **Failure path:** if Transak returns `FAILED`, `REFUNDED`, `EXPIRED` or `CANCELLED`, or nothing happens within 30 minutes, the adapter calls `refund` and **the USDT returns to the sender.**

### How we show the receiver got the money
- **Transak order** `COMPLETED` with fiat amount and card ••1519 (Transak staging dashboard + `GET /partners/api/v2/orders?filter[partnerOrderId]=…`).
- **Whitechain** `PayoutCompleted` event carrying the same Transak order ID and amount, visible on the explorer.
- **To build:** an Arkiv `GharReceipt` (written by the adapter: order ID, amount, Whitechain tx) and a **payee view** page ("Rent → Paid $40.10 to card ••1519 → order 03bd… → tx"). The Whitechain Operate track requires a business/payee view.

---

## 3. Proof it works (Whitechain Sepolia, 6 Nov 2026)

- Contract (verified): `0x6f142dD4c466d12Bb8D95f9822311BcBB42fee3d` (https://explorer.testnet.whitechain.io/address/0x6f142dD4c466d12Bb8D95f9822311BcBB42fee3d)
- Operator (adapter) address: `0xe36Eb61730c38EFe1500cD1604F40379c4C36702`
- Test USDT: `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (6 decimals)

Payout #1, full success in about 2.5 minutes:
```
22:54:03 [Whitechain] payout #1: 1 USDT to "rent"     tx 0x22600ad888deaa4b32e7d4e08cc572409980f9aaa8aa953935bc3389f1354d70
22:54:05 [Transak] order created, partnerOrderId ghar-6f142d-1-1793919243510
22:54:31 [Transak] 03bdc1de-4a92-4ce6-9fba-889580e0e39e: AWAITING_PAYMENT_FROM_USER
22:54:37 [Sepolia] deposited 0.02 ETH                   tx 0x61100cfe4a55860c61dc7f3e751fad19bc0ce58c43397aabecdc1212347e0a54
22:55:08 [Transak] PENDING_DELIVERY_FROM_TRANSAK
22:56:22 [Transak] COMPLETED
22:56:25 [Whitechain] markPaid #1: 40.1 USD delivered    tx 0x447c0127efafbe457bed307e07427d6f7915cbc25b8a54425c57bff64ff4d66e
```
Payout #0 was refunded on chain by the operator (the refund path works).

---

## 4. What's in the zip

```
contracts/
  src/GharPayout.sol        escrow: requestPayout, markPaid, refund (+ events)
  script/Deploy.s.sol       deploy to Whitechain Sepolia (USDT hardcoded)
  test/MockUSDT.sol         USDT-like token for local anvil tests
  foundry.toml              solc 0.8.30, evm prague, rpc alias whitechain_sepolia
adapter/
  index.mjs                 event watcher -> provider -> markPaid/refund
  transak.mjs               Transak staging client (token, widget URL, order poll, Sepolia deposit)
  onramp.mjs                Onramp.money client (INR; live public rate; white-label sandbox when keys arrive)
  setup-payee.mjs           Onramp payee onboarding (only for PROVIDER=onramp)
  .env.example
README.md                   step-by-step commands
INTEGRATION.md              this file
```

### Contract interface (what the Ghar vault must match)
```solidity
event PayoutRequested(uint256 indexed id, address indexed sender, uint256 amount, bytes32 payeeRef);
event PayoutCompleted(uint256 indexed id, string providerTxId, uint256 inrPaise); // fiat minor units (cents/paise)
event PayoutRefunded(uint256 indexed id, string reason);

function requestPayout(uint256 amount, bytes32 payeeRef) external returns (uint256 id); // pulls USDT
function markPaid(uint256 id, string calldata providerTxId, uint256 inrPaise) external; // onlyOperator -> USDT to treasury
function refund(uint256 id, string calldata reason) external;                         // onlyOperator -> USDT to sender
```

---

## 5. How to integrate into Ghar

**Option A (fastest): keep GharPayout as a separate contract.** The vault's `pay(bill)` does its checks (bill on Arkiv from the ENS biller, ENS payee, agent cap, payee cap), then approves GharPayout and calls `requestPayout(amount, payeeRef)`. The adapter runs unchanged.

**Option B: merge into the vault.** Copy `requestPayout` / `markPaid` / `refund` and the three events into the vault, with **identical event signatures**. The adapter only reads `PayoutRequested`. Point `GHAR_PAYOUT_ADDRESS` at the vault.

Then:
1. **payeeRef → ENS:** use `bytes32` of the subname label (`"rent"`) or `namehash("rent.you.eth")`. Add an ENS lookup in the adapter if the payout reference should come from the ENS `payout` record.
2. **Arkiv receipt:** in `finish()` in `adapter/index.mjs`, after `markPaid`, create a `GharReceipt` entity (bill key, Transak order ID, fiat amount, Whitechain tx) from the provider/adapter wallet.
3. **Payee view:** read `PayoutRequested`/`PayoutCompleted`/`PayoutRefunded` from the contract and show status, amount, order ID and links.
4. **Sender view:** show pending/paid/refunded per payout from the same events.

---

## 6. Run it

```bash
# contracts
cd contracts
forge install foundry-rs/forge-std --no-git
export OPERATOR_ADDRESS=0x...        # adapter wallet address
forge script script/Deploy.s.sol:Deploy --rpc-url whitechain_sepolia --private-key $SENDER_PK --broadcast

# adapter
cd ../adapter && npm install
# create .env (below), then:
npm start
```

`.env` for Transak (no inline comments after values):
```
RPC_URL=https://rpc.testnet.whitechain.io
GHAR_PAYOUT_ADDRESS=0x...            # deployed contract
OPERATOR_PRIVATE_KEY=0x...           # must match OPERATOR_ADDRESS used at deploy; needs a little WBT for gas
PROVIDER=transak
TRANSAK_API_KEY=...                  # Transak dashboard -> Staging -> Developers
TRANSAK_API_SECRET=...
TRANSAK_SELL_ETH=0.02
TRANSAK_EMAIL=                       # set name+failed@gmail.com to demo FAILED -> refund
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
SEPOLIA_PRIVATE_KEY=0x...            # provider treasury wallet with Sepolia ETH (>= 0.03 per payout)
```

Trigger a payout (second terminal, adapter must already be running):
```bash
cast send $USDT "approve(address,uint256)" $G 1000000 --rpc-url $RPC --private-key $SENDER_PK
cast send $G "requestPayout(uint256,bytes32)" 1000000 $(cast format-bytes32-string rent) --rpc-url $RPC --private-key $SENDER_PK
```
Then the **payee** opens the printed widget link within 5 minutes and confirms with:
- Card `4024 7644 4997 1519`, expiry `10/33`, CVV `000`; any code `000000`
- First-time KYC (staging test user): Doe Jane, +12125550142, DOB 01-01-1998, 179 Richmond Oak, CA 94016, SSN 123456789

---

## 7. Gotchas (all hit during testing)

- **Start the adapter before `requestPayout`.** It only watches new events. A payout requested while it's down stays locked; recover it with
  `cast send $G "refund(uint256,string)" <id> "adapter offline" --private-key $OPERATOR_PK --rpc-url $RPC`.
- **Transak staging is USD only** for the US test user (GBP cards fail with "You are allowed to do USD transactions only"). INR is not available in Transak staging. For INR, `PROVIDER=onramp` (live public Onramp rate, simulated settlement) until Onramp white-label keys are approved.
- **Don't send the Sepolia ETH by hand.** The adapter does it; sending twice wastes funds.
- **The widget link is single-use and expires in 5 minutes.** If it expires, the order times out and the adapter refunds after 30 minutes. Just request a new payout.
- **Transak's $3.99 minimum fee** makes tiny orders look expensive ($4.44 on $44.55). Don't quote that as Ghar's cost.
- **Keys:** all keys used so far are testnet/staging and were shared in chat. Rotate them after the hackathon; never commit `.env`.

---

## 8. What to say to judges

> "Money and rules live on Whitechain: the sender's USDT is locked, released or refunded only by contract. The payout runs through a real provider order (Transak sandbox): the payee is KYC'd by the provider and confirms to their verified card; the provider is repaid in USDT on Whitechain. Sandboxes don't do INR, so in production the INR leg goes through an India-licensed partner like Onramp.money."
