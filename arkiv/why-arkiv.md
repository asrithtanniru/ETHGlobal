# Why Arkiv

**What users would lose with Postgres.** Today the family and the sender would have to trust Ghar's database to say who posted a bill and whether it was paid. On Arkiv:

- `$creator` is set by the chain, so a biller's identity can't be faked by Ghar or anyone else. That's the check the agent relies on.
- Bills and receipts are `readonly`, so nobody, including Ghar, can quietly edit one after posting.
- The inbox is public, so another wallet app or a different agent can read and pay the same bills without our API.
- Bills clear themselves after their deadline, with no clean-up job.

**What we kept off Arkiv.**

- Money and limits stay in the vault on Whitechain, because they need contract enforcement.
- Payee verification stays in ENS, because only the provider's verifier may write it.
- Bank details stay with the licensed provider. ENS holds only a reference, because Arkiv attributes are public.
- The Arkiv access key stays on the server, in the app's read proxy.
