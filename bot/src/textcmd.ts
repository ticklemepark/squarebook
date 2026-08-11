import { sameAddress } from "../../web/src/lib/types";
import { fetchLedger } from "./chain";
import { handleButton, handleChat, handleCommand, type Button, type Reply } from "./engine";
import { discordIdFor } from "./users";

/**
 * Text-command layer for button-less transports (iMessage). Short reply
 * commands map onto the same engine actions the Discord buttons trigger;
 * anything that isn't a command falls through to the conversational flow
 * (in DMs) or is ignored (in group chats, so the bot isn't chatty).
 */

const HELP = [
  "**Squarebook commands**",
  "`bet <name> <qty> <unit> <terms>` — propose a bet (or just describe it in a DM)",
  "`accept 3` / `decline 3` — answer an offer",
  "`won 3` / `lost 3` / `push 3` — claim a result",
  "`agree 3` / `dispute 3` / `dispute 3 push` — answer a claim",
  "`vote 3 <name|push>` · `finalize 3` — group votes",
  "`paid 3` — clear a debt you're owed · `double 3 <terms>` — double or nothing",
  "`pending` · `balance` · `whoami` · `ledger`",
  "`addmember <phone> <name>` — add a friend",
  "`group` (in a DM) — create the Squarebook group chat · `nogroup` — back to DM feed",
].join("\n");

/** Render a Reply's buttons as a reply-command hint line. */
export function commandHint(buttons?: Button[]): string {
  if (!buttons?.length) return "";
  const cmds = buttons.map((b) => buttonToCommand(b)).filter(Boolean);
  return cmds.length ? `\n↩️ Reply: ${cmds.map((c) => `\`${c}\``).join(" · ")}` : "";
}

function buttonToCommand(b: Button): string | undefined {
  const [action, id] = b.id.split(":");
  switch (action) {
    case "accept": return `accept ${id}`;
    case "decline": return `decline ${id}`;
    case "cancel": return `cancel ${id}`;
    case "claimwin": return `won ${id}`;
    case "claimloss": return `lost ${id}`;
    case "claimpush": return `push ${id}`;
    case "agree": return `agree ${id}`;
    case "disputewin": return `dispute ${id}`;
    case "disputepush": return `dispute ${id} push`;
    case "escalate": return `escalate ${id}`;
    case "votepush": return `vote ${id} push`;
    case "votemaker":
    case "votetaker": {
      // labels look like "#5: Alex won" — recover the name for the hint
      const m = b.label.match(/^#\d+:\s*(.+?)\s+won$/);
      return m ? `vote ${id} ${m[1]}` : `vote ${id} <name>`;
    }
    case "finalize": return `finalize ${id}`;
    case "paid": return `paid ${id}`;
    case "chatsend": return "send";
    case "chatcancel": return "cancel";
    default: return undefined;
  }
}

const SIMPLE_BUTTONS: Record<string, string> = {
  accept: "accept",
  decline: "decline",
  agree: "agree",
  escalate: "escalate",
  finalize: "finalize",
  paid: "paid",
  won: "claimwin",
  lost: "claimloss",
  concede: "claimloss",
  push: "claimpush",
};

export async function handleText(userId: string, raw: string, context: "dm" | "group"): Promise<Reply[]> {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (lower === "help" || lower === "commands") return [{ content: HELP }];
  if (lower === "pending" || lower === "balance" || lower === "balances" || lower === "whoami" || lower === "ledger")
    return [await handleCommand(userId, lower === "balances" ? "balance" : lower, {})];

  // chat confirm-card responses (DM flow)
  if (context === "dm" && (lower === "send" || lower === "yes"))
    return [await handleButton(userId, "chatsend")];

  // "<verb> <betId> [...]"
  const m = text.match(/^([a-zA-Z]+)\s+(\d+)\s*(.*)$/);
  if (m) {
    const [, verbRaw, idStr, rest] = m;
    const verb = verbRaw.toLowerCase();
    const restTrim = rest.trim();

    if (verb in SIMPLE_BUTTONS && !restTrim) return [await handleButton(userId, `${SIMPLE_BUTTONS[verb]}:${idStr}`)];
    if (verb === "cancel" && !restTrim) return [await handleButton(userId, `cancel:${idStr}`)];
    if (verb === "dispute")
      return [await handleButton(userId, restTrim.toLowerCase() === "push" ? `disputepush:${idStr}` : `disputewin:${idStr}`)];
    if (verb === "double" && restTrim) return [await handleCommand(userId, "double", { id: Number(idStr), terms: restTrim })];
    if (verb === "vote") {
      const choice = restTrim.toLowerCase();
      if (!choice) return [{ content: `Vote for whom? \`vote ${idStr} <name>\` or \`vote ${idStr} push\`` }];
      if (choice === "push" || choice === "void" || choice === "tie") return [await handleButton(userId, `votepush:${idStr}`)];
      const ledger = await fetchLedger();
      const bet = ledger.bets[Number(idStr)];
      if (!bet) return [{ content: `⚠️ No bet #${idStr}.` }];
      const named = ledger.members.find((mm) => mm.name.toLowerCase() === choice);
      if (named && sameAddress(named.address, bet.maker)) return [await handleButton(userId, `votemaker:${idStr}`)];
      if (named && sameAddress(named.address, bet.taker)) return [await handleButton(userId, `votetaker:${idStr}`)];
      return [{ content: `⚠️ "${restTrim}" isn't a party to bet #${idStr} — vote for one of the two bettors or \`push\`.` }];
    }
  }

  // "addmember <handle> <name...>"
  const am = text.match(/^addmember\s+(\S+)\s+(.+)$/i);
  if (am) return [await handleCommand(userId, "addmember", { user: am[1], name: am[2].trim() })];

  // "bet <memberName> <qty> <unit> <terms...>"
  const bm = text.match(/^bet\s+(\S+)\s+(\d+)\s+(\S+)\s+(.+)$/i);
  if (bm) {
    const ledger = await fetchLedger();
    const named = ledger.members.find((mm) => mm.name.toLowerCase() === bm[1].toLowerCase());
    if (!named) return [{ content: `⚠️ No member named "${bm[1]}". Try \`pending\`-style natural chat in a DM, or check \`whoami\`.` }];
    const targetId = discordIdFor(named.address);
    if (!targetId) return [{ content: `⚠️ I don't know ${named.name}'s handle yet — they need to message me once, or use the DM chat flow.` }];
    return [await handleCommand(userId, "bet", { user: targetId, qty: Number(bm[2]), unit: bm[3], terms: bm[4].trim() })];
  }

  // not a command: DMs get the conversational flow, groups stay quiet
  if (context === "dm") return handleChat(userId, text);
  return [];
}

