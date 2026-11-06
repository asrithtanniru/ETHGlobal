# How we use Arkiv

| Feature | Where | What the user sees |
| --- | --- | --- |
| `createdBy(biller)` | `openBills` in `packages/arkiv/src/read.ts` | The agent never acts on a fake bill |
| Query without creator scope | `billsForPayee`, used by `/app/bills` | Fake bills appear as "ignored" with the reason |
| Indexed `payee`, `dueDate` | `openBills` | Only open bills for that payee are fetched |
| Indexed `digest` | `receiptForDigest`, `billByDigest` | Activity rows link to their receipt |
| `readonly` flag | `packages/arkiv/src/write.ts` | A posted bill or receipt can't change |
| Expiry at due date + 7 days | `postBill` | Old bills leave the inbox on their own |
| `ExpirationTime.max()` | `postReceipt` | Receipts stay readable for about six months |
| `createdBy(provider)` | Receipt reads | Family only sees receipts from the vault's provider |

Who can edit: nobody, since both types are `readonly`. The owner can still delete or transfer an entity, so the agent also checks the biller's signature instead of trusting ownership.
