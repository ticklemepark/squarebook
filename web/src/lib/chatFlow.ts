import type { Address } from "viem";
import type { Member } from "./types";

/**
 * Deterministic chat flow for creating a bet. Pure reducer so it can be
 * unit-tested: (state, input, members) -> { state, replies }.
 * No LLM on purpose — a static site can't hide an API key, and a guided
 * flow never misparses.
 */

export interface Draft {
  taker?: Address;
  takerName?: string;
  description?: string;
  qty?: number;
  unit?: string;
}

export type ChatState =
  | { step: "idle" }
  | { step: "counterparty"; draft: Draft }
  | { step: "terms"; draft: Draft }
  | { step: "stake"; draft: Draft }
  | { step: "confirm"; draft: Draft };

export type BotReply =
  | { kind: "text"; text: string }
  | { kind: "memberChips" }
  | { kind: "unitChips" }
  | { kind: "confirm"; draft: Required<Draft> }
  | { kind: "showPending" }
  | { kind: "showBalances" };

export type ChatEffect = { type: "propose"; draft: Required<Draft> };

export interface ChatResult {
  state: ChatState;
  replies: BotReply[];
  effect?: ChatEffect;
}

export const CANONICAL_UNITS = ["coffee", "dessert", "dinner", "USD"];

export const GREETING = "What's the bet, and who's it with? You can also say \"pending\" or \"balance\".";

/** "beers" -> "beer"; "$" amounts -> USD. Keeps custom units from fragmenting. */
export function normalizeUnit(raw: string): string {
  let unit = raw.trim().toLowerCase();
  if (unit === "usd" || unit === "$" || unit === "dollar" || unit === "dollars" || unit === "buck" || unit === "bucks")
    return "USD";
  if (unit.endsWith("s") && unit.length > 3 && !unit.endsWith("ss")) unit = unit.slice(0, -1);
  return unit;
}

export function parseStake(text: string): { qty: number; unit: string } | undefined {
  const t = text.trim();
  const dollar = t.match(/^\$\s*(\d+)$/) ?? t.match(/^(\d+)\s*(?:usd|dollars?|bucks?)$/i);
  if (dollar) return { qty: Number(dollar[1]), unit: "USD" };
  const counted = t.match(/^(\d+)\s*x?\s*([a-zA-Z][a-zA-Z ]{0,30})$/);
  if (counted) return { qty: Number(counted[1]), unit: normalizeUnit(counted[2]) };
  const article = t.match(/^(?:an?\s+)?([a-zA-Z][a-zA-Z ]{0,30})$/);
  if (article) return { qty: 1, unit: normalizeUnit(article[1]) };
  return undefined;
}

/** Find a member whose name appears as a word in the text (excluding `me`). */
export function findMember(text: string, members: Member[], me?: Address): Member | undefined {
  const lower = ` ${text.toLowerCase()} `;
  return members.find(
    (m) =>
      m.address.toLowerCase() !== me?.toLowerCase() &&
      lower.includes(` ${m.name.toLowerCase()} `),
  );
}

function askStake(draft: Draft): ChatResult {
  return {
    state: { step: "stake", draft },
    replies: [
      { kind: "text", text: `Got it — vs ${draft.takerName}. What's at stake?` },
      { kind: "unitChips" },
    ],
  };
}

function maybeConfirm(draft: Draft): ChatResult {
  if (draft.taker && draft.description && draft.qty && draft.unit) {
    return {
      state: { step: "confirm", draft },
      replies: [{ kind: "confirm", draft: draft as Required<Draft> }],
    };
  }
  return askStake(draft);
}

const COMMANDS: Record<string, BotReply> = {
  pending: { kind: "showPending" },
  balance: { kind: "showBalances" },
  balances: { kind: "showBalances" },
};

export function chatReduce(
  state: ChatState,
  text: string,
  members: Member[],
  me?: Address,
): ChatResult {
  const trimmed = text.trim();
  const command = COMMANDS[trimmed.toLowerCase()];

  if (state.step === "idle" || command) {
    if (command) return { state: { step: "idle" }, replies: [command] };
    if (trimmed.toLowerCase() === "help" || trimmed.toLowerCase() === "cancel")
      return { state: { step: "idle" }, replies: [{ kind: "text", text: GREETING }] };

    const found = findMember(trimmed, members, me);
    if (found) return askStake({ taker: found.address, takerName: found.name, description: trimmed });
    return {
      state: { step: "counterparty", draft: { description: trimmed } },
      replies: [{ kind: "text", text: "Who's the bet with?" }, { kind: "memberChips" }],
    };
  }

  if (trimmed.toLowerCase() === "cancel")
    return { state: { step: "idle" }, replies: [{ kind: "text", text: "Canceled. " + GREETING }] };

  switch (state.step) {
    case "counterparty": {
      const found = findMember(trimmed, members, me);
      if (!found)
        return {
          state,
          replies: [
            { kind: "text", text: "I don't recognize that name — pick a member:" },
            { kind: "memberChips" },
          ],
        };
      const draft = { ...state.draft, taker: found.address, takerName: found.name };
      if (!draft.description)
        return {
          state: { step: "terms", draft },
          replies: [{ kind: "text", text: "What are the terms of the bet?" }],
        };
      return maybeConfirm(draft);
    }
    case "terms":
      return maybeConfirm({ ...state.draft, description: trimmed });
    case "stake": {
      const stake = parseStake(trimmed);
      if (!stake)
        return {
          state,
          replies: [
            { kind: "text", text: 'Tell me a quantity and a unit — like "2 coffees" or "$20".' },
            { kind: "unitChips" },
          ],
        };
      return maybeConfirm({ ...state.draft, qty: stake.qty, unit: stake.unit });
    }
    case "confirm": {
      if (trimmed === "__send__") {
        return {
          state: { step: "idle" },
          replies: [],
          effect: { type: "propose", draft: state.draft as Required<Draft> },
        };
      }
      return { state: { step: "idle" }, replies: [{ kind: "text", text: "Canceled. " + GREETING }] };
    }
  }
}
