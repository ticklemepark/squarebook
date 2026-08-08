/**
 * Deploys BetBook with the bot operator's derived account as first member.
 *
 *   OWNER_DISCORD_ID=<your discord user id> OWNER_NAME=Timothy \
 *   DEPLOYER_KEY=0x... RPC_URL=https://sepolia.base.org CHAIN_ID=84532 \
 *   MASTER_SEED=<strong secret> pnpm --filter bot deploy
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

const ownerId = process.env.OWNER_DISCORD_ID;
const ownerName = process.env.OWNER_NAME ?? "Owner";
if (!ownerId) {
  console.error("Set OWNER_DISCORD_ID (your Discord user id) and OWNER_NAME.");
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
console.log(`  first member ${ownerName} (${owner.address}) for Discord id ${ownerId}`);
