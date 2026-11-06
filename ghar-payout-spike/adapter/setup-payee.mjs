// One-time: register a payee with Onramp sandbox and save their ids to payees.json.
// Usage: node setup-payee.mjs <label> <phone e.g. +91-9876543210> <email> <bankAccount> <IFSC>
import fs from 'node:fs';
import 'dotenv/config';
import { MOCK, createUser, sandboxSetKyc, addFiatAccount } from './onramp.mjs';

const [label, phoneNumber, email, fiatAccount, ifsc] = process.argv.slice(2);
if (!label) { console.log('usage: node setup-payee.mjs <label> <+91-phone> <email> <account> <ifsc>'); process.exit(1); }

const file = new URL('./payees.json', import.meta.url);
const payees = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};

if (MOCK) {
  payees[label] = { customerId: `mock-cust-${label}`, fiatAccountId: `mock-fiat-${label}`, name: label };
  fs.writeFileSync(file, JSON.stringify(payees, null, 2));
  console.log(`MOCK payee "${label}" saved. Add ONRAMP_API_KEY/SECRET to .env to use the real sandbox.`);
  process.exit(0);
}

const user = await createUser({ email, phoneNumber, clientCustomerId: `ghar-${label}`, type: 'INDIVIDUAL', closeAfterLogin: true });
console.log('customerId:', user.customerId);
console.log('Open this KYC link and enter OTP 123456 (sandbox):\n ', user.kycUrl);
console.log('Press Enter once the OTP step is done...');
await new Promise((r) => process.stdin.once('data', r));

await sandboxSetKyc(user.customerId, 'COMPLETED');
console.log('KYC marked COMPLETED (sandbox).');

const fiat = await addFiatAccount({ customerId: user.customerId, fiatAccount, ifsc });
console.log('fiatAccountId:', fiat.fiatAccountId);

payees[label] = { customerId: user.customerId, fiatAccountId: fiat.fiatAccountId, name: label };
fs.writeFileSync(file, JSON.stringify(payees, null, 2));
console.log(`Saved payee "${label}" to payees.json`);
process.exit(0);
