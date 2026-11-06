# Arkiv feedback

From building Ghar's bill inbox with SDK 1.0.1 on Rabdi.

1. **Quickstart uses methods the typed client doesn't declare.** The guarded adapter calls `publicClient.estimateGas`, `getGasPrice` and `sendRawTransaction`. The client from `createPublicClient` in `@arkiv-network/sdk` doesn't type these. Expected: the sample compiles under `strict`. Reproduce: paste the adapter into a TypeScript file typed with the SDK client. Workaround: a plain viem client on `rabdi({ accessKey })` for the write path.
2. **The safe write path is a lot of code to copy.** About 150 lines of adapter for one create. A built-in guarded create in the SDK would remove the riskiest copy-paste.
3. **`str()` limit of 128 bytes is easy to hit.** A 66-character digest fits, but a long provider reference needs trimming before writing. A clearer limit in the column docs would help.
4. **No way to look up an entity's explorer page from a key in the docs we found.** We link to the Whitechain transaction instead.
