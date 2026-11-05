// Reads a payee's records the way the agent will.
// Usage: npm run read -w @ghar/ens -- <tag>
import { PAYEE_BOOK_PARENT } from "@ghar/shared";
import { buildPayeeName, getVerifiedPayee } from "../src/index.ts";
import { publicClient } from "./client.ts";

const tag = process.argv[2];
if (!tag) throw new Error("usage: read <tag>");
console.log(await getVerifiedPayee(publicClient, buildPayeeName(PAYEE_BOOK_PARENT, tag)));
