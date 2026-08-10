# 🎲 Squarebook

A friend group's bet ledger that lives in **iMessage** and settles on a **public
blockchain**. Bets, outcomes, and unpaid debts are recorded in a smart contract;
a texting agent (via [Photon](https://photon.codes)'s Spectrum SDK) is the
friendly face on top. No real money is held on-chain: stakes are quantities of
real-world things ("2 coffees", "$20", "a dinner") settled in person — the
ledger's job is making sure unpaid spoils stay visible until the winner says
they were paid.

**Trust model (read this once):** the agent signs transactions on members'
behalf with keys derived from a master seed, so whoever runs it *could* forge
actions — but every action is instantly broadcast to the group thread and
permanently, publicly attributed on the chain. Nobody — operator included — can
rewrite history. It's "no silent edits, ever," enforced by cryptography;
"no lies" is enforced by your friends watching the feed.

## What it looks like

- Text the agent: *"I bet Alex 2 coffees the Lakers win Friday"* — it walks you
  through and sends the offer.
- Alex gets a text: *"Timothy bets you 2 × coffee: …"* `↩️ Reply: accept 3 · decline 3`
- Either side claims a result (`won 3` / `lost 3` / `push 3`); the other replies
  `agree 3` or `dispute 3`.
- Disputes land in the group thread as a **vote**: `vote 3 Alex` or `vote 3 push`
  (3-day window, majority ends early, ties void the bet; the two parties can't
  vote; members added mid-dispute can't vote).
- `balance` shows who owes what, summed per unit. Only the **winner** can reply
  `paid 3`, so debts can't be erased by the person who owes.
- `double 3 <terms>` on an unpaid win offers double or nothing: win and the debt
  doubles, lose and everyone's clear, push and the original debt stands.
- Ghosting a claim for 3 days lets the claimant `escalate 3` straight to a vote.

Text `help` for the full command list. Identity is just your phone number — no
wallets, no apps, no seed phrases, no gas.

## Repo layout

```
contracts/   Solidity (Foundry) — BetBook.sol is the whole backend (55 tests)
bot/         The agent — engine + Photon/iMessage adapter (+ Discord adapter)
web/         Vite + React SPA — optional web view / local dev harness
```

The engine is transport-agnostic: `bot/src/engine.ts` holds all the logic,
`bot/src/photon.ts` (iMessage, default) and `bot/src/index.ts` (Discord,
`pnpm start:discord`) are thin adapters.

## Local development

Requires [Foundry](https://getfoundry.sh) and [pnpm](https://pnpm.io).

```bash
pnpm install
forge build --root contracts && pnpm generate   # typed ABI
forge test --root contracts                     # contract tests
anvil                                           # terminal 1: local chain
pnpm --filter bot e2e                           # terminal 2: full lifecycle e2e
```

The e2e (43 assertions) runs the entire engine — membership, offers, text
commands, balances, double-or-nothing, dispute votes, DM chat flow, and the
notifier — against a fresh local chain with four fake users.

## Running it for real

1. **Photon** — create a project at [app.photon.codes](https://app.photon.codes)
   and copy `PROJECT_ID` / `PROJECT_SECRET` into `bot/.env` (template:
   `bot/.env.example`). Free tier covers a friend group: 10 users, no
   per-message cost.
2. **Contract** — get free Base Sepolia ETH from a faucet into the funder key,
   then from `bot/`:
   ```bash
   OWNER_ID=+15551234567 OWNER_NAME=Timothy pnpm deploy
   # put the printed CONTRACT_ADDRESS into bot/.env
   ```
   (`OWNER_ID` is your own iMessage handle — E.164 phone number.)
3. **Run the agent** — `pnpm --filter bot start` on any always-on machine.
   No inbound ports; Spectrum connects outbound.
4. **Group feed** — add the agent's number to your friend-group iMessage
   thread; the first group it hears becomes the public feed (or pin one with
   `HOME_SPACE_ID`).
5. **Onboard friends** — text the agent `addmember +1555… Alex` and they're
   live.

Back up `MASTER_SEED` — it derives every member's key and is the only custody.
The `FUNDER_KEY` wallet pays gas top-ups (fractions of a microcent per action
on Base Sepolia; a single faucet drip funds hundreds of bets).

Reply `ledger` to get the contract address — anyone can audit the full history
on [sepolia.basescan.org](https://sepolia.basescan.org) without trusting the
agent.
