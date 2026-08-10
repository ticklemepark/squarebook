/**
 * End-to-end exercise of the whole bot engine against a fresh anvil chain:
 * membership, propose/accept via buttons, resolve, balances, double or
 * nothing, dispute + group vote, DM chat flow, and the event notifier.
 * Run: anvil (fresh) in one terminal, then `pnpm --filter bot e2e`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// force local values BEFORE config loads .env — the e2e must be hermetic
// even when a production .env exists next to it (dotenv never overrides
// already-set variables)
process.env.RPC_URL = "http://127.0.0.1:8545";
process.env.CHAIN_ID = "31337";
process.env.MASTER_SEED = "e2e-test-seed";
process.env.FUNDER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil #0
delete process.env.CONTRACT_ADDRESS;
// anvil's ~2 gwei gas needs bigger top-ups than Base Sepolia's ~0.006 gwei
process.env.MIN_BALANCE_ETH = "0.001";
process.env.TOP_UP_ETH = "0.05";

const { CHAIN, FUNDER_KEY, RPC_URL } = await import("../src/config");
const { publicClient, read } = await import("../src/chain");
const { accountFor } = await import("../src/keys");
const { handleCommand, handleButton, handleChat } = await import("../src/engine");
const { handleText, commandHint } = await import("../src/textcmd");
const { startWatcher } = await import("../src/notify");
const { Status } = await import("../../web/src/lib/types");

// iMessage-style handles: users are phone numbers now
const TIMOTHY = "+15550000100", ALEX = "+15550000200", SAM = "+15550000300", PRIYA = "+15550000400";

let passed = 0;
function assert(cond: unknown, label: string) {
  if (!cond) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const testClient = createTestClient({ mode: "anvil", chain: CHAIN, transport: http(RPC_URL) });
async function advanceTime(seconds: number) {
  await testClient.increaseTime({ seconds });
  await testClient.mine({ blocks: 1 });
}

// ---- deploy fresh contract with Timothy as first member
const artifact = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../contracts/out/BetBook.sol/BetBook.json"), "utf8"),
);
const deployer = createWalletClient({ account: privateKeyToAccount(FUNDER_KEY), chain: CHAIN, transport: http(RPC_URL) });
const deployHash = await deployer.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [[accountFor(TIMOTHY).address], ["Timothy"]],
});
const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash: deployHash });
process.env.CONTRACT_ADDRESS = contractAddress!;
console.log(`deployed BetBook at ${contractAddress}`);

async function status(id: number): Promise<number> {
  return Number(((await read<{ status: number }>("getBet", [BigInt(id)])) as { status: number }).status);
}

// ---- membership
console.log("membership:");
let r = await handleCommand(TIMOTHY, "addmember", { user: ALEX, name: "Alex" });
if (!r.content.includes("Welcome")) console.error("DEBUG addmember reply:", r.content);
assert(r.content.includes("Alex"), "Timothy adds Alex");
r = await handleCommand(ALEX, "addmember", { user: SAM, name: "Sam" });
assert(r.content.includes("Sam"), "Alex adds Sam");
r = await handleCommand(TIMOTHY, "addmember", { user: PRIYA, name: "Priya" });
assert(r.content.includes("Priya"), "Timothy adds Priya");
r = await handleCommand("999", "bet", { user: ALEX, qty: 1, unit: "coffee", terms: "x" });
assert(r.content.includes("not a member"), "non-member is rejected");
await advanceTime(86_400); // members must predate disputes for vote eligibility

// ---- collect notifier output from here on
const outbound: { kind: string; discordId?: string; content: string }[] = [];
const unwatch = startWatcher((o) => {
  outbound.push({ kind: o.kind, discordId: o.discordId, content: o.reply.content });
});

// ---- propose via /bet, accept via button
console.log("lifecycle:");
r = await handleCommand(TIMOTHY, "bet", { user: ALEX, qty: 2, unit: "coffees", terms: "Lakers win Friday" });
assert(r.content.includes("Bet proposed"), "/bet proposes");
assert((await status(0)) === Status.Proposed, "bet 0 proposed on-chain");
r = await handleButton(ALEX, "accept:0");
assert(r.content.includes("live"), "Alex accepts via button");
assert((await status(0)) === Status.Active, "bet 0 active");

// ---- resolve: Alex concedes, Timothy agrees
r = await handleCommand(ALEX, "resolve", { id: 0, outcome: "they-won" });
assert(r.content.includes("claimed"), "Alex concedes via /resolve");
r = await handleButton(TIMOTHY, "agree:0");
assert(r.content.includes("resolved"), "Timothy agrees via button");
assert((await status(0)) === Status.Resolved, "bet 0 resolved");

// ---- balances
r = await handleCommand(TIMOTHY, "balance", {});
assert(r.content.includes("owes you **2 × coffee"), "balance shows Alex owes 2 coffee");
assert(r.buttons?.some((b) => b.id === "paid:0"), "creditor gets mark-paid button");
r = await handleCommand(ALEX, "balance", {});
assert(r.content.includes("You owe"), "debtor sees debt without paid button");

// ---- double or nothing: offer, accept, original loser wins -> all clear
console.log("double or nothing:");
r = await handleCommand(ALEX, "double", { id: 0, terms: "rematch" });
assert(r.content.includes("⚠️"), "loser cannot double");
r = await handleCommand(TIMOTHY, "double", { id: 0, terms: "Rematch: Celtics game" });
assert(r.content.includes("4 × coffee"), "winner offers double for 4 coffee");
r = await handleButton(ALEX, "accept:1");
assert((await status(1)) === Status.Active, "double child active");
assert((await status(0)) === Status.Superseded, "parent superseded");
r = await handleCommand(ALEX, "resolve", { id: 1, outcome: "i-won" });
r = await handleButton(TIMOTHY, "agree:1");
assert((await status(1)) === Status.Settled, "child auto-settled when original loser wins");
assert((await status(0)) === Status.Superseded, "parent debt wiped (stays superseded)");
r = await handleCommand(TIMOTHY, "balance", {});
assert(r.content.includes("All square"), "balances clear after double loss");

// ---- dispute + group vote, driven through the iMessage text-command layer
console.log("dispute (via text commands):");
let tr = await handleText(TIMOTHY, "bet Sam 20 USD Sam is late again", "group");
assert(tr[0].content.includes("Bet proposed"), "text `bet Sam 20 USD …` proposes");
tr = await handleText(SAM, "accept 2", "dm");
assert((await status(2)) === Status.Active, "text `accept 2` works");
tr = await handleText(TIMOTHY, "won 2", "dm");
assert((await status(2)) === Status.Claimed, "text `won 2` claims");
tr = await handleText(SAM, "dispute 2", "group");
assert(tr[0].content.includes("group votes"), "text `dispute 2` disputes");
assert((await status(2)) === Status.Disputed, "bet 2 disputed");
tr = await handleText(TIMOTHY, "vote 2 Timothy", "group");
assert(tr[0].content.includes("⚠️"), "party cannot vote own dispute");
tr = await handleText(ALEX, "vote 2 Timothy", "group");
assert(tr[0].content.includes("Vote cast"), "text `vote 2 Timothy` resolves name to maker");
tr = await handleText(PRIYA, "vote 2 timothy", "group");
assert(tr[0].content.includes("Vote cast"), "vote name matching is case-insensitive");
tr = await handleText(SAM, "finalize 2", "group");
assert(tr[0].content.includes("finalized"), "text `finalize 2` finalizes on early majority");
assert((await status(2)) === Status.Resolved, "bet 2 resolved by vote");
tr = await handleText(ALEX, "what a ripoff", "group");
assert(tr.length === 0, "non-command group chatter is ignored");
tr = await handleText(ALEX, "vote 2 Priya", "group");
assert(tr[0].content.includes("isn't a party"), "voting for a non-party is rejected");
assert(commandHint([{ id: "accept:9", label: "Accept" }, { id: "votemaker:9", label: "#9: Alex won" }]).includes("`accept 9`"), "buttons render as reply hints");
assert(commandHint([{ id: "votemaker:9", label: "#9: Alex won" }]).includes("vote 9 Alex"), "vote hints recover the name");

// ---- DM chat flow
console.log("chat flow:");
let replies = await handleChat(TIMOTHY, "I bet Priya the sun rises tomorrow");
assert(replies.some((x) => x.content.includes("What's at stake")), "chat recognizes Priya, asks stake");
replies = await handleChat(TIMOTHY, "3 desserts");
const confirm = replies.find((x) => x.buttons?.some((b) => b.id === "chatsend"));
assert(confirm?.content.includes("3 × dessert"), "chat confirm card with parsed stake");
r = await handleButton(TIMOTHY, "chatsend");
assert(r.content.includes("Priya"), "chat send proposes on-chain");
assert((await status(3)) === Status.Proposed, "bet 3 proposed from chat");

// ---- notifier
console.log("notifier:");
await sleep(4000);
unwatch();
assert(outbound.some((o) => o.kind === "channel" && o.content.includes("Dispute on #2")), "dispute posted to channel with vote buttons");
assert(outbound.some((o) => o.kind === "dm" && o.discordId === ALEX && o.content.includes("bets you")), "taker DM'd the offer");
assert(outbound.some((o) => o.kind === "dm" && o.discordId === PRIYA), "Priya DM'd the chat-created offer");
assert(outbound.some((o) => o.kind === "channel" && o.content.includes("resolved by group vote")), "vote result posted");

console.log(`\nALL PASSED (${passed} assertions)`);
process.exit(0);
