// Registers a family name on ENSv2 Sepolia pointing at the provider's resolver, deploying that
// resolver on the first run. Safe to re-run: skips whatever already exists.
// Usage: PAYEE_FAMILY=<family.eth> npm run setup -w @ghar/ens
import {
  createWalletClient, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi,
  toHex, zeroAddress, zeroHash, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash } from "viem/ens";
import { ENS_V2_SEPOLIA, PAYEE_BOOK_PARENT, PAYEE_BOOK_RESOLVER, ensChain } from "@ghar/shared";
import { payeeFamily } from "../src/index.ts";
import { env, publicClient, resolverAbi, ROLE_SET_TEXT, transport } from "./client.ts";

const owner = privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY") as Hex);
const verifier = env("PROVIDER_ADDRESS") as Address;
const wallet = createWalletClient({ account: owner, chain: ensChain, transport });
const family = payeeFamily();
const label = family.replace(/\.eth$/, "");
const ONE_YEAR = 365n * 24n * 60n * 60n;

const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "function predictProxyAddress(address deployer, uint256 salt) view returns (address)",
]);
const registrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256, uint256)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);
const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

async function send(what: string, hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${what} failed: ${hash}`);
  console.log(`${what}: ${hash}`);
}

// 1. Resolver. The verifier is the only account with any role, so nobody else can write
//    records and nobody can upgrade it.
const salt = BigInt(keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
  [keccak256(toHex("OwnedResolver")), namehash(PAYEE_BOOK_PARENT), 0n],
)));
// Every family shares the provider's resolver, so only the first family deploys it.
const resolver = family !== PAYEE_BOOK_PARENT ? PAYEE_BOOK_RESOLVER : await publicClient.readContract({
  address: ENS_V2_SEPOLIA.verifiableFactory, abi: factoryAbi,
  functionName: "predictProxyAddress", args: [owner.address, salt],
});
if (await publicClient.getCode({ address: resolver })) {
  console.log(`resolver already deployed: ${resolver}`);
} else {
  const data = encodeFunctionData({
    abi: resolverAbi, functionName: "initialize",
    args: [[{ account: verifier, roleBitmap: ROLE_SET_TEXT }], []],
  });
  await send("deploy resolver", await wallet.writeContract({
    address: ENS_V2_SEPOLIA.verifiableFactory, abi: factoryAbi,
    functionName: "deployProxy", args: [ENS_V2_SEPOLIA.permissionedResolverImpl, salt, data],
  }));
}
const roleOf = (account: Address) => publicClient.readContract({
  address: resolver, abi: resolverAbi, functionName: "hasRootRoles", args: [ROLE_SET_TEXT, account],
});
if (!(await roleOf(verifier)) || (await roleOf(owner.address))) {
  throw new Error("resolver roles are wrong: only the verifier may set text");
}

// 2. Parent name, registered already pointing at the resolver.
const registrar = { address: ENS_V2_SEPOLIA.ethRegistrar, abi: registrarAbi } as const;
if (!(await publicClient.readContract({ ...registrar, functionName: "isAvailable", args: [label] }))) {
  console.log(`${family} is already registered`);
} else {
  const [base, premium] = await publicClient.readContract({
    ...registrar, functionName: "getRegisterPrice", args: [label, ONE_YEAR, ENS_V2_SEPOLIA.mockUsdc],
  });
  const price = base + premium;
  const usdc = { address: ENS_V2_SEPOLIA.mockUsdc, abi: usdcAbi } as const;
  const balance = await publicClient.readContract({ ...usdc, functionName: "balanceOf", args: [owner.address] });
  if (balance < price) {
    await send("mint MockUSDC", await wallet.writeContract({ ...usdc, functionName: "mint", args: [owner.address, price - balance] }));
  }
  const allowance = await publicClient.readContract({ ...usdc, functionName: "allowance", args: [owner.address, registrar.address] });
  if (allowance < price) {
    await send("approve registrar", await wallet.writeContract({ ...usdc, functionName: "approve", args: [registrar.address, price] }));
  }

  const secret = keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
  const commitment = await publicClient.readContract({
    ...registrar, functionName: "makeCommitment",
    args: [label, owner.address, secret, zeroAddress, resolver, ONE_YEAR, zeroHash],
  });
  await send("commit", await wallet.writeContract({ ...registrar, functionName: "commit", args: [commitment] }));
  const wait = Number(await publicClient.readContract({ ...registrar, functionName: "MIN_COMMITMENT_AGE" })) + 15;
  console.log(`waiting ${wait}s for the commitment to mature...`);
  await new Promise((r) => setTimeout(r, wait * 1000));
  await send("register", await wallet.writeContract({
    ...registrar, functionName: "register",
    args: [label, owner.address, secret, zeroAddress, resolver, ONE_YEAR, ENS_V2_SEPOLIA.mockUsdc, zeroHash],
  }));
}

console.log(`\n${family} owner ${owner.address}\nresolver ${resolver}\nverifier ${verifier}`);
