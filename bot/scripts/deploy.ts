/**
 * Deploys BetBook with the bot operator's derived account as first member.
 *
 *   OWNER_ID=<your handle: iMessage phone like +15551234567, or Discord id> \
 *   OWNER_NAME=Timothy pnpm --filter bot deploy
 *
 * DEPLOYER_KEY defaults to FUNDER_KEY; RPC_URL/CHAIN_ID/MASTER_SEED from .env.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, FUNDER_KEY, RPC_URL } from "../src/config";
import { publicClient } from "../src/chain";
import { accountFor } from "../src/keys";

const artifactPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../contracts/out/BetBook.sol/BetBook.json",
);
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

const ownerId = process.env.OWNER_ID ?? process.env.OWNER_DISCORD_ID;
const ownerName = process.env.OWNER_NAME ?? "Owner";
if (!ownerId) {
  console.error("Set OWNER_ID (your iMessage phone number in E.164 form, e.g. +15551234567) and OWNER_NAME.");
  process.exit(1);
}

const owner = accountFor(ownerId);
const deployer = privateKeyToAccount((process.env.DEPLOYER_KEY ?? FUNDER_KEY) as `0x${string}`);
const wallet = createWalletClient({ account: deployer, chain: CHAIN, transport: http(RPC_URL) });

const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [[owner.address], [ownerName]],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });

console.log(`BetBook deployed`);
console.log(`  CONTRACT_ADDRESS=${receipt.contractAddress}`);
console.log(`  deploy block=${receipt.blockNumber}`);
console.log(`  first member ${ownerName} (${owner.address}) for handle ${ownerId}`);
