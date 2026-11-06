// Reads a payee's records the way the agent will.
// Usage: npm run read -w @ghar/ens -- <tag>
import { buildPayeeName, getVerifiedPayee, payeeFamily } from "../src/index.ts";
import { publicClient } from "./client.ts";

const tag = process.argv[2];
if (!tag) throw new Error("usage: read <tag>");
console.log(await getVerifiedPayee(publicClient, buildPayeeName(payeeFamily(), tag)));
