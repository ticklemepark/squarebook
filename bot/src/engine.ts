import type { Address } from "viem";
import { NO_BET, Outcome, Status, stakeLabel, sameAddress, type Bet, type Ledger } from "../../web/src/lib/types";
import {
  canDouble,
  isExpired,
  isParty,
  memberName,
  netByUnit,
  openDebts,
  pairwiseDebts,
  pendingItems,
  winnerOf,
} from "../../web/src/lib/derive";
import { chatReduce, normalizeUnit, GREETING, type ChatState, type Draft } from "../../web/src/lib/chatFlow";
import { fetchLedger } from "./chain";
import { accountFor } from "./keys";
import { sendAs } from "./tx";
import { recordUser } from "./users";
import { EXPLORER_URL, contractAddress } from "./config";

export interface Button {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "success" | "danger";
}

export interface Reply {
  content: string;
  buttons?: Button[];
  ephemeral?: boolean;
}

const WEEK = 7 * 24 * 3600;
const now = () => Math.floor(Date.now() / 1000);

function fail(message: string): Reply {
  return { content: `⚠️ ${message}`, ephemeral: true };
}

async function requireMember(discordId: string): Promise<{ me: Address; ledger: Ledger } | Reply> {
  const me = recordUser(discordId);
  const ledger = await fetchLedger(me);
  if (!ledger.members.some((m) => sameAddress(m.address, me)))
    return fail(
      "You're not a member yet. Ask an existing member to run `/addmember` on you — that's all it takes.",
    );
  return { me, ledger };
}

function betLine(ledger: Ledger, b: Bet): string {
  return `**#${b.id}** ${b.description} · ${stakeLabel(b.stakeQty, b.stakeUnit)} (${memberName(ledger.members, b.maker)} vs ${memberName(ledger.members, b.taker)})`;
}

/** Buttons for whatever the user can do about a bet right now. */
export function actionButtons(ledger: Ledger, b: Bet, me: Address): Button[] {
  const iAmMaker = sameAddress(b.maker, me);
  const buttons: Button[] = [];
  switch (b.status) {
    case Status.Proposed:
      if (sameAddress(b.taker, me) && !isExpired(b, now()))
        buttons.push(
          { id: `accept:${b.id}`, label: `Accept #${b.id}`, style: "success" },
          { id: `decline:${b.id}`, label: `Decline #${b.id}`, style: "danger" },
        );
      else if (iAmMaker) buttons.push({ id: `cancel:${b.id}`, label: `Cancel #${b.id}`, style: "secondary" });
      break;
    case Status.Active:
      if (isParty(b, me))
        buttons.push(
          { id: `claimwin:${b.id}`, label: `#${b.id} I won`, style: "primary" },
          { id: `claimloss:${b.id}`, label: `#${b.id} they won`, style: "secondary" },
          { id: `claimpush:${b.id}`, label: `#${b.id} push`, style: "secondary" },
        );
      break;
    case Status.Claimed:
      if (isParty(b, me) && !sameAddress(b.claimant, me)) {
        buttons.push({ id: `agree:${b.id}`, label: `Agree #${b.id}`, style: "success" });
        const myWin = iAmMaker ? Outcome.MakerWins : Outcome.TakerWins;
        if (b.claimedOutcome !== myWin)
          buttons.push({ id: `disputewin:${b.id}`, label: `#${b.id} no, I won`, style: "danger" });
        if (b.claimedOutcome !== Outcome.Push)
          buttons.push({ id: `disputepush:${b.id}`, label: `#${b.id} it's a push`, style: "secondary" });
      } else if (sameAddress(b.claimant, me) && now() > Number(b.claimedAt) + 3 * 24 * 3600) {
        buttons.push({ id: `escalate:${b.id}`, label: `Escalate #${b.id} to vote`, style: "danger" });
      }
      break;
    case Status.Disputed:
      if (!isParty(b, me) && !ledger.myVotes.has(b.id)) buttons.push(...voteButtons(ledger, b));
      buttons.push({ id: `finalize:${b.id}`, label: `Finalize #${b.id}`, style: "secondary" });
      break;
    case Status.Resolved: {
      const w = winnerOf(b);
      if (w && sameAddress(w, me)) buttons.push({ id: `paid:${b.id}`, label: `Mark #${b.id} paid`, style: "success" });
      break;
    }
  }
  return buttons;
}

export function voteButtons(ledger: Ledger, b: Bet): Button[] {
  return [
    { id: `votemaker:${b.id}`, label: `#${b.id}: ${memberName(ledger.members, b.maker)} won`, style: "primary" },
    { id: `votetaker:${b.id}`, label: `#${b.id}: ${memberName(ledger.members, b.taker)} won`, style: "primary" },
    { id: `votepush:${b.id}`, label: `#${b.id}: push/void`, style: "secondary" },
  ];
}

// ------------------------------------------------------------------ commands

export async function handleCommand(
  discordId: string,
  name: string,
  opts: Record<string, string | number | undefined>,
): Promise<Reply> {
  try {
    switch (name) {
      case "whoami": {
        const me = recordUser(discordId);
        const ledger = await fetchLedger(me);
        const member = ledger.members.find((m) => sameAddress(m.address, me));
        return {
          content: member
            ? `You're **${member.name}** — wallet \`${me}\``
            : `Your wallet is \`${me}\`. You're not a member yet — ask a member to run \`/addmember\` on you.`,
          ephemeral: true,
        };
      }

      case "addmember": {
        const gate = await requireMember(discordId);
        if ("content" in gate) return gate;
        const targetId = String(opts.user);
        const memberNameArg = String(opts.name ?? "").trim();
        if (!memberNameArg) return fail("Give them a name, e.g. `/addmember @sam Sam`.");
        const targetAddr = recordUser(targetId);
        await sendAs(discordId, "addMember", [targetAddr, memberNameArg]);
        return { content: `Welcome **${memberNameArg}** <@${targetId}> — you're on the ledger. 🎲` };
      }

      case "bet": {
        const gate = await requireMember(discordId);
        if ("content" in gate) return gate;
        const { me, ledger } = gate;
        const targetId = String(opts.user);
        const taker = accountFor(targetId).address;
        if (sameAddress(taker, me)) return fail("You can't bet yourself.");
        if (!ledger.members.some((m) => sameAddress(m.address, taker)))
          return fail("They're not a member yet — `/addmember` them first.");
        const qty = Number(opts.qty);
        const unit = normalizeUnit(String(opts.unit ?? ""));
        const terms = String(opts.terms ?? "").trim();
        if (!qty || qty < 1 || !unit || !terms) return fail("Usage: `/bet @who qty unit terms`.");
        const days = Number(opts.days ?? 7) || 7;
        await sendAs(discordId, "proposeBet", [taker, terms, qty, unit, BigInt(now() + days * 24 * 3600)]);
        return {
          content: `Bet proposed to <@${targetId}>: **${terms}** for **${stakeLabel(qty, unit)}**. They have ${days} days to accept.`,
        };
      }

      case "pending": {
        const gate = await requireMember(discordId);
        if ("content" in gate) return gate;
        const { me, ledger } = gate;
        const items = pendingItems(ledger, me, now());
        if (items.length === 0) return { content: "Nothing pending. All quiet. 🎲", ephemeral: true };
        const lines = items.map((i) => `${betLine(ledger, i.bet)} — _${i.label}_`);
        const buttons = items
          .filter((i) => i.myAction)
          .slice(0, 6)
          .flatMap((i) => actionButtons(ledger, i.bet, me));
        return { content: lines.join("\n"), buttons, ephemeral: true };
      }

      case "balance": {
        const gate = await requireMember(discordId);
        if ("content" in gate) return gate;
        const { me, ledger } = gate;
        const debts = openDebts(ledger.bets);
        const net = [...netByUnit(debts, me).entries()].filter(([, v]) => v !== 0);
        const pairs = pairwiseDebts(debts).filter(
          (p) => sameAddress(p.debtor, me) || sameAddress(p.creditor, me),
        );
        if (net.length === 0 && pairs.length === 0)
          return { content: "All square — no open debts. 🤝", ephemeral: true };
        const netLine = net
          .map(([unit, qty]) => `${qty > 0 ? "🟢 +" : "🔴 −"}${stakeLabel(Math.abs(qty), unit)}`)
          .join(" · ");
        const rows = pairs.map((p) =>
          sameAddress(p.creditor, me)
            ? `**${memberName(ledger.members, p.debtor)}** owes you **${stakeLabel(p.qty, p.unit)}** (bets ${p.betIds.map((i) => `#${i}`).join(", ")})`
            : `You owe **${memberName(ledger.members, p.creditor)}** **${stakeLabel(p.qty, p.unit)}** (bets ${p.betIds.map((i) => `#${i}`).join(", ")})`,
        );
        const buttons = pairs
          .filter((p) => sameAddress(p.creditor, me))
          .flatMap((p) => p.betIds)
          .slice(0, 10)
          .map((id): Button => ({ id: `paid:${id}`, label: `Mark #${id} paid`, style: "success" }));
        return { content: [netLine, ...rows].filter(Boolean).join("\n"), buttons, ephemeral: true };
      }

      case "resolve": {
        const gate = await requireMember(discordId);
        if ("content" in gate) return gate;
        const { me, ledger } = gate;
        const bet = ledger.bets[Number(opts.id)];
        if (!bet) return fail(`No bet #${opts.id}.`);
        const iAmMaker = sameAddress(bet.maker, me);
        const outcome =
          opts.outcome === "push"
            ? Outcome.Push
            : (opts.outcome === "i-won") === iAmMaker
              ? Outcome.MakerWins
              : Outcome.TakerWins;
        await sendAs(discordId, "claimOutcome", [BigInt(bet.id), outcome]);
        return { content: `Result claimed on ${betLine(ledger, bet)} — waiting for the other side to confirm.` };
      }

      case "paid": {
        const gate = await requireMember(discordId);
        if ("content" in gate) return gate;
        await sendAs(discordId, "markSettled", [BigInt(Number(opts.id))]);
        return { content: `Debt on bet #${opts.id} marked paid. 🎉` };
      }

      case "double": {
        const gate = await requireMember(discordId);
        if ("content" in gate) return gate;
        const { me, ledger } = gate;
        const bet = ledger.bets[Number(opts.id)];
        if (!bet) return fail(`No bet #${opts.id}.`);
        if (!canDouble(bet, ledger.bets, me, now()))
          return fail("Double or nothing needs a resolved, unpaid bet that you won (and no live rematch).");
        const terms = String(opts.terms ?? "").trim();
        if (!terms) return fail("Give the rematch terms: `/double id terms`.");
        await sendAs(discordId, "proposeDoubleOrNothing", [BigInt(bet.id), terms, BigInt(now() + WEEK)]);
        return {
          content: `Double or nothing offered on ${betLine(ledger, bet)} → win and it's **${stakeLabel(bet.stakeQty * 2, bet.stakeUnit)}**, lose and nobody owes anything.`,
        };
      }

      case "ledger": {
        const ledger = await fetchLedger();
        const link = EXPLORER_URL ? `\nVerify independently: ${EXPLORER_URL}/address/${contractAddress()}` : "";
        return {
          content: `${ledger.bets.length} bets · ${ledger.members.length} members · contract \`${contractAddress()}\`${link}\nNobody — including the bot operator — can rewrite history; every action is permanently attributed on-chain.`,
          ephemeral: true,
        };
      }

      default:
        return fail(`Unknown command ${name}.`);
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

// ------------------------------------------------------------------- buttons

export async function handleButton(discordId: string, customId: string): Promise<Reply> {
  const [action, idStr] = customId.split(":");
  try {
    if (action === "chatsend" || action === "chatcancel") return handleChatButton(discordId, action);

    const gate = await requireMember(discordId);
    if ("content" in gate) return gate;
    const { me, ledger } = gate;
    const bet = ledger.bets[Number(idStr)];
    if (!bet) return fail(`No bet #${idStr}.`);
    const id = BigInt(bet.id);
    const iAmMaker = sameAddress(bet.maker, me);
    const myWin = iAmMaker ? Outcome.MakerWins : Outcome.TakerWins;

    switch (action) {
      case "accept":
        await sendAs(discordId, "acceptBet", [id]);
        return { content: `You're on — ${betLine(ledger, bet)} is live. 🎲` };
      case "decline":
        await sendAs(discordId, "declineBet", [id]);
        return { content: `Declined ${betLine(ledger, bet)}.` };
      case "cancel":
        await sendAs(discordId, "cancelBet", [id]);
        return { content: `Canceled your proposal #${bet.id}.` };
      case "claimwin":
        await sendAs(discordId, "claimOutcome", [id, myWin]);
        return { content: `Claimed the win on #${bet.id} — waiting for the other side.` };
      case "claimloss":
        await sendAs(discordId, "claimOutcome", [id, iAmMaker ? Outcome.TakerWins : Outcome.MakerWins]);
        return { content: `Conceded #${bet.id} — good sport. Waiting for confirmation.` };
      case "claimpush":
        await sendAs(discordId, "claimOutcome", [id, Outcome.Push]);
        return { content: `Called #${bet.id} a push — waiting for the other side.` };
      case "agree":
        await sendAs(discordId, "respondToClaim", [id, bet.claimedOutcome]);
        return { content: `Agreed — #${bet.id} is resolved.` };
      case "disputewin":
        await sendAs(discordId, "respondToClaim", [id, myWin]);
        return { content: `Disputed #${bet.id} — the group votes now.` };
      case "disputepush":
        await sendAs(discordId, "respondToClaim", [id, Outcome.Push]);
        return { content: `Disputed #${bet.id} as a push — the group votes now.` };
      case "escalate":
        await sendAs(discordId, "escalate", [id]);
        return { content: `Escalated #${bet.id} to a group vote — silence doesn't win bets.` };
      case "votemaker":
        await sendAs(discordId, "vote", [id, Outcome.MakerWins]);
        return { content: `Vote cast on #${bet.id}.`, ephemeral: true };
      case "votetaker":
        await sendAs(discordId, "vote", [id, Outcome.TakerWins]);
        return { content: `Vote cast on #${bet.id}.`, ephemeral: true };
      case "votepush":
        await sendAs(discordId, "vote", [id, Outcome.Push]);
        return { content: `Vote cast on #${bet.id}.`, ephemeral: true };
      case "finalize":
        await sendAs(discordId, "finalizeVote", [id]);
        return { content: `Vote finalized on #${bet.id}.` };
      case "paid":
        await sendAs(discordId, "markSettled", [id]);
        return { content: `Debt on #${bet.id} marked paid. 🎉` };
      default:
        return fail(`Unknown action ${action}.`);
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------- DM conversation

interface Session {
  state: ChatState;
  draft?: Required<Draft>;
}
const sessions = new Map<string, Session>();

async function handleChatButton(discordId: string, action: string): Promise<Reply> {
  const session = sessions.get(discordId);
  if (action === "chatcancel" || !session?.draft) {
    sessions.set(discordId, { state: { step: "idle" } });
    return { content: "Canceled. " + GREETING };
  }
  const d = session.draft;
  sessions.set(discordId, { state: { step: "idle" } });
  try {
    await sendAs(discordId, "proposeBet", [d.taker, d.description, d.qty, d.unit, BigInt(now() + WEEK)]);
    return { content: `Sent — waiting for **${d.takerName}** to accept. 🎲` };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export async function handleChat(discordId: string, text: string): Promise<Reply[]> {
  const me = recordUser(discordId);
  const ledger = await fetchLedger(me);
  if (!ledger.members.some((m) => sameAddress(m.address, me)))
    return [fail("You're not on the ledger yet — ask a member to `/addmember` you, then let's bet.")];

  const session = sessions.get(discordId) ?? { state: { step: "idle" } as ChatState };
  const result = chatReduce(session.state, text, ledger.members, me);
  sessions.set(discordId, { state: result.state });

  const replies: Reply[] = [];
  for (const r of result.replies) {
    switch (r.kind) {
      case "text":
        replies.push({ content: r.text });
        break;
      case "memberChips":
        replies.push({
          content:
            "Members: " +
            ledger.members
              .filter((m) => !sameAddress(m.address, me))
              .map((m) => `**${m.name}**`)
              .join(", "),
        });
        break;
      case "unitChips":
        replies.push({ content: 'Try something like `2 coffees`, `$20`, or `a dinner`.' });
        break;
      case "confirm":
        sessions.set(discordId, { state: result.state, draft: r.draft });
        replies.push({
          content: `**Review:** vs **${r.draft.takerName}** — ${r.draft.description} · **${stakeLabel(r.draft.qty, r.draft.unit)}**`,
          buttons: [
            { id: "chatsend", label: "Send bet", style: "success" },
            { id: "chatcancel", label: "Cancel", style: "secondary" },
          ],
        });
        break;
      case "showPending":
        replies.push(await handleCommand(discordId, "pending", {}));
        break;
      case "showBalances":
        replies.push(await handleCommand(discordId, "balance", {}));
        break;
    }
  }
  return replies;
}
