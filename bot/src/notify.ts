
import { NO_BET, Outcome, Status, stakeLabel, sameAddress } from "../../web/src/lib/types";
import { memberName, winnerOf, loserOf } from "../../web/src/lib/derive";
import { betBookAbi, fetchLedger, publicClient } from "./chain";
import { contractAddress } from "./config";
import { discordIdFor } from "./users";
import { actionButtons, voteButtons, type Reply } from "./engine";

export interface Outbound {
  kind: "dm" | "channel";
  discordId?: string;
  reply: Reply;
  /**
   * For "channel" events on transports without a group feed (iMessage free
   * tier): the member user-ids to broadcast to, minus anyone who already got
   * a targeted DM for this same event. Discord ignores this and uses the
   * feed channel.
   */
  fanout?: string[];
}

type Emit = (o: Outbound) => Promise<void> | void;


async function onLogs(logs: { eventName?: string; args?: Record<string, unknown> }[], emit: Emit) {
  // one ledger fetch per batch; names/state are read after the event landed
  const ledger = await fetchLedger();
  const name = (a?: unknown) => memberName(ledger.members, a as string | undefined);
  // every member with a known handle, minus those already DM'd for the event
  const fanoutFor = (...exclude: (string | undefined)[]) =>
    ledger.members
      .map((m) => discordIdFor(m.address))
      .filter((id): id is string => !!id && !exclude.includes(id));

  for (const log of logs) {
    const a = (log.args ?? {}) as Record<string, never>;
    const betId = a.id !== undefined ? Number(a.id) : a.parentId !== undefined ? Number(a.parentId) : undefined;
    const bet = betId !== undefined ? ledger.bets[betId] : undefined;
    const stake = bet ? stakeLabel(bet.stakeQty, bet.stakeUnit) : "";

    switch (log.eventName) {
      case "MemberAdded":
        await emit({ kind: "channel", fanout: fanoutFor(), reply: { content: `👋 **${a.name}** joined the ledger.` } });
        break;

      case "BetProposed": {
        if (!bet) break;
        const isDouble = (a.parentId as bigint) !== NO_BET;
        const takerId = discordIdFor(bet.taker);
        await emit({
          kind: "channel",
          fanout: fanoutFor(takerId),
          reply: {
            content: `📣 **${name(bet.maker)}** ${isDouble ? "offers **double or nothing** to" : "proposes to"} **${name(bet.taker)}**: ${bet.description} · **${stake}**`,
          },
        });
        if (takerId)
          await emit({
            kind: "dm",
            discordId: takerId,
            reply: {
              content: isDouble
                ? `🎲 **${name(bet.maker)}** offers double or nothing: **${bet.description}** — win and you owe nothing, lose and it's **${stake}**.`
                : `🎲 **${name(bet.maker)}** bets you **${stake}**: ${bet.description}`,
              buttons: [
                { id: `accept:${bet.id}`, label: "Accept", style: "success" },
                { id: `decline:${bet.id}`, label: "Decline", style: "danger" },
              ],
            },
          });
        break;
      }

      case "BetAccepted": {
        if (!bet) break;
        const makerId = discordIdFor(bet.maker);
        await emit({ kind: "channel", fanout: fanoutFor(makerId), reply: { content: `🤝 Bet #${bet.id} is on: ${bet.description} · **${stake}**` } });
        if (makerId)
          await emit({
            kind: "dm",
            discordId: makerId,
            reply: { content: `**${name(bet.taker)}** accepted #${bet.id}: ${bet.description}. Game on. 🎲` },
          });
        break;
      }

      case "BetDeclined":
      case "BetCanceled": {
        if (!bet) break;
        const verb = log.eventName === "BetDeclined" ? "declined" : "canceled";
        const notifyAddr = log.eventName === "BetDeclined" ? bet.maker : bet.taker;
        const notifyId = discordIdFor(notifyAddr);
        await emit({ kind: "channel", fanout: fanoutFor(notifyId), reply: { content: `🚫 Bet #${bet.id} ${verb}.` } });
        if (notifyId)
          await emit({ kind: "dm", discordId: notifyId, reply: { content: `Bet #${bet.id} (${bet.description}) was ${verb}.` } });
        break;
      }

      case "OutcomeClaimed": {
        // narrate from event args — the bet may have moved on within this
        // poll batch; only attach buttons if a response is still possible
        if (!bet) break;
        const claimant = a.claimant as string;
        const claimed = Number(a.outcome);
        const other = sameAddress(claimant, bet.maker) ? bet.taker : bet.maker;
        const otherId = discordIdFor(other);
        const claimLabel =
          claimed === Outcome.Push
            ? "it's a push"
            : sameAddress(claimant, bet.maker) === (claimed === Outcome.MakerWins)
              ? "they won"
              : "you won";
        if (otherId)
          await emit({
            kind: "dm",
            discordId: otherId,
            reply: {
              content: `⏳ **${name(claimant)}** says **${claimLabel}** on #${bet.id}: ${bet.description} · ${stake}`,
              buttons: bet.status === Status.Claimed ? actionButtons(ledger, bet, other) : undefined,
            },
          });
        break;
      }

      case "ClaimDisputed": {
        if (!bet) break;
        const stillOpen = bet.status === Status.Disputed;
        await emit({
          kind: "channel",
          fanout: fanoutFor(),
          reply: {
            content: `🗳️ **Dispute on #${bet.id}** — ${bet.description} · ${stake}\n${name(bet.maker)} vs ${name(bet.taker)} disagree. Everyone else: cast your vote (3-day window, majority ends it early).`,
            buttons: stillOpen
              ? [...voteButtons(ledger, bet), { id: `finalize:${bet.id}`, label: `Finalize #${bet.id}`, style: "secondary" }]
              : undefined,
          },
        });
        break;
      }

      case "VoteCast":
        if (bet)
          await emit({
            kind: "channel",
            fanout: fanoutFor(),
            reply: {
              content: `🗳️ ${name(a.voter)} voted on #${bet.id} — tally: ${name(bet.maker)} ${bet.votesMaker} · ${name(bet.taker)} ${bet.votesTaker} · push ${bet.votesPush}`,
            },
          });
        break;

      case "BetResolved": {
        if (!bet) break;
        const outcomeText =
          bet.outcome === Outcome.Push
            ? "push — nobody owes anything"
            : `**${name(winnerOf(bet))}** wins — **${name(loserOf(bet))}** owes **${stake}**`;
        const w = winnerOf(bet);
        const winnerId = w ? discordIdFor(w) : undefined;
        await emit({
          kind: "channel",
          fanout: fanoutFor(bet.status === Status.Resolved ? winnerId : undefined),
          reply: { content: `✅ Bet #${bet.id} resolved${a.byVote ? " by group vote" : ""}: ${outcomeText}` },
        });
        if (winnerId && bet.status === Status.Resolved)
          await emit({
            kind: "dm",
            discordId: winnerId,
            reply: {
              content: `🏆 You won #${bet.id} — **${name(loserOf(bet))}** owes you **${stake}**. When they pay up, mark it. Feeling lucky? \`double ${bet.id} <rematch terms>\``,
              buttons: [{ id: `paid:${bet.id}`, label: "Mark paid", style: "success" }],
            },
          });
        break;
      }

      case "BetSettled": {
        if (!bet) break;
        const auto = (a.markedBy as string) === "0x0000000000000000000000000000000000000000";
        await emit({
          kind: "channel",
          fanout: fanoutFor(),
          reply: { content: auto ? `⚖️ Bet #${bet.id} settled — nothing owed.` : `💸 Debt on #${bet.id} paid and cleared — ${name(bet.maker)} and ${name(bet.taker)} are square.` },
        });
        break;
      }

      case "BetSuperseded":
        await emit({
          kind: "channel",
          fanout: fanoutFor(),
          reply: { content: `♻️ Double or nothing accepted — the debt on #${Number(a.parentId)} now rides on #${Number(a.childId)}. Stakes doubled.` },
        });
        break;

      case "ParentRestored":
        await emit({
          kind: "channel",
          fanout: fanoutFor(),
          reply: { content: `↩️ Rematch #${Number(a.childId)} was a push — the original debt on #${Number(a.parentId)} stands.` },
        });
        break;
    }
  }
}

/** Watch the contract and translate every event into channel posts and DMs. */
export function startWatcher(emit: Emit): () => void {
  return publicClient.watchContractEvent({
    address: contractAddress(),
    abi: betBookAbi,
    pollingInterval: 2000,
    onLogs: (logs) => void onLogs(logs as never, emit).catch((e) => console.error("notify error:", e)),
  });
}
