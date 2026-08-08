# 🎲 Squarebook

A friend group's bet ledger that lives in **Discord** and settles on a **public
blockchain**. Bets, outcomes, and unpaid debts are recorded in a smart contract;
the Discord bot is just the friendly face on top. No real money is held on-chain:
stakes are quantities of real-world things ("2 coffees", "$20", "a dinner")
settled in person — the ledger's job is making sure unpaid spoils stay visible
until the winner says they were paid.

**Trust model (read this once):** the bot signs transactions on members' behalf
with keys derived from a master seed, so whoever runs the bot *could* forge
actions — but every action is instantly broadcast to the group and permanently,
publicly attributed on the chain. Nobody — operator included — can rewrite
history. It's "no silent edits, ever," enforced by cryptography; "no lies" is
enforced by your friends watching the feed.

## What it looks like

- DM the bot: *"I bet Alex 2 coffees the Lakers win Friday"* → it walks you
  through and posts the offer.
- Alex gets a DM with **[Accept] [Decline]** buttons.
- Either side claims a result; the other taps **[Agree]** or disputes.
- Disputes go to the channel as a **group vote** with buttons (3-day window,
  majority ends early, ties void the bet; the two parties can't vote; members
  added mid-dispute can't vote).
- `/balance` shows who owes what, summed per unit. Only the **winner** can mark
  a debt paid, so debts can't be erased by the person who owes.
- `/double` on an unpaid win offers double or nothing: the rematch is a new bet
  the loser must accept — win and the debt doubles, lose and everyone's clear,
  push and the original debt stands.
- If someone claims and the other side ghosts for 3 days, the claimant can
  escalate straight to a group vote.

**Slash commands:** `/bet` `/pending` `/balance` `/resolve` `/paid` `/double`
`/addmember` `/whoami` `/ledger` — plus free-form betting in DMs.

## Repo layout

```
contracts/   Solidity (Foundry) — BetBook.sol is the whole backend (55 tests)
bot/         Discord bot — discord.js + viem, signs with per-user derived keys
web/         Vite + React SPA — optional web view / local dev harness
```

## Local development

Requires [Foundry](https://getfoundry.sh) and [pnpm](https://pnpm.io).

```bash
pnpm install
forge build --root contracts && pnpm generate   # typed ABI
forge test --root contracts                     # contract tests
anvil                                           # terminal 1: local chain
pnpm --filter bot e2e                           # terminal 2: full bot lifecycle e2e
```

The e2e runs the entire engine — membership, propose/accept buttons, resolve,
balances, double-or-nothing, dispute votes, DM chat flow, and the notifier —
against a fresh local chain with four fake users.

## Running it for real

1. **Discord app** — [discord.com/developers/applications](https://discord.com/developers/applications)
   → New Application → Bot: copy the token, enable the **Message Content**
   privileged intent. Under OAuth2 → URL Generator pick scope `bot` with *Send
   Messages* permission, open the URL, invite it to your server. Grab your
   server id and a feed channel id (right-click → Copy ID, with Developer Mode
   on).
2. **Contract** — get free Base Sepolia ETH from a faucet into a throwaway key,
   then:
   ```bash
   cd bot && cp .env.example .env   # fill in everything
   OWNER_DISCORD_ID=<your id> OWNER_NAME=Timothy pnpm deploy
   # put the printed CONTRACT_ADDRESS into bot/.env
   ```
3. **Run the bot** — `pnpm --filter bot start` on any always-on machine (spare
   laptop, Raspberry Pi, fly.io free tier). No inbound ports needed — Discord
   bots connect outbound.
4. **Onboard friends** — they're identified by their Discord account; any
   member runs `/addmember @friend Name` and they're live. Zero wallets, zero
   seed phrases, zero gas.

Back up `MASTER_SEED` — it derives every member's key and is the only custody.
The `FUNDER_KEY` wallet pays gas top-ups (fractions of a cent on Base Sepolia's
free faucet ETH).

`/ledger` prints the contract address so anyone can audit the full history on
[sepolia.basescan.org](https://sepolia.basescan.org) without trusting the bot.
