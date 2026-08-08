import type { Address } from "viem";
import { type Bet, type Ledger, type Member, Outcome, Status, sameAddress } from "./types";

export function memberName(members: Member[], address?: string): string {
  const m = members.find((x) => sameAddress(x.address, address));
  if (m) return m.name;
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "?";
}

/** Proposed bets past their accept-by deadline are dead — a view-layer state. */
export function isExpired(bet: Bet, nowSec: number): boolean {
  return bet.status === Status.Proposed && BigInt(nowSec) > bet.acceptBy;
}

export function winnerOf(bet: Bet): Address | undefined {
  if (bet.outcome === Outcome.MakerWins) return bet.maker;
  if (bet.outcome === Outcome.TakerWins) return bet.taker;
  return undefined;
}

export function loserOf(bet: Bet): Address | undefined {
  if (bet.outcome === Outcome.MakerWins) return bet.taker;
  if (bet.outcome === Outcome.TakerWins) return bet.maker;
  return undefined;
}

export function otherParty(bet: Bet, me: Address): Address {
  return sameAddress(bet.maker, me) ? bet.taker : bet.maker;
}

export function isParty(bet: Bet, me?: Address): boolean {
  return !!me && (sameAddress(bet.maker, me) || sameAddress(bet.taker, me));
}

/** An unpaid debt: `debtor` owes `creditor` qty × unit. */
export interface Debt {
  betId: number;
  debtor: Address;
  creditor: Address;
  qty: number;
  unit: string;
}

/** Open debts = resolved-with-a-winner bets not yet marked paid. */
export function openDebts(bets: Bet[]): Debt[] {
  const debts: Debt[] = [];
  for (const b of bets) {
    if (b.status !== Status.Resolved) continue;
    const winner = winnerOf(b);
    const loser = loserOf(b);
    if (!winner || !loser) continue;
    debts.push({ betId: b.id, debtor: loser, creditor: winner, qty: b.stakeQty, unit: b.stakeUnit });
  }
  return debts;
}

/** Net position per unit from `me`'s point of view (positive = owed to me). */
export function netByUnit(debts: Debt[], me: Address): Map<string, number> {
  const net = new Map<string, number>();
  for (const d of debts) {
    if (sameAddress(d.creditor, me)) net.set(d.unit, (net.get(d.unit) ?? 0) + d.qty);
    else if (sameAddress(d.debtor, me)) net.set(d.unit, (net.get(d.unit) ?? 0) - d.qty);
  }
  return net;
}

/** Debts aggregated per (debtor, creditor, unit) pair for the balances list. */
export interface PairDebt {
  debtor: Address;
  creditor: Address;
  unit: string;
  qty: number;
  betIds: number[];
}

export function pairwiseDebts(debts: Debt[]): PairDebt[] {
  const map = new Map<string, PairDebt>();
  for (const d of debts) {
    const key = `${d.debtor.toLowerCase()}|${d.creditor.toLowerCase()}|${d.unit}`;
    const row = map.get(key);
    if (row) {
      row.qty += d.qty;
      row.betIds.push(d.betId);
    } else {
      map.set(key, { debtor: d.debtor, creditor: d.creditor, unit: d.unit, qty: d.qty, betIds: [d.betId] });
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty);
}

export type ActionKind = "accept" | "respond" | "vote" | "markPaid" | "waiting";

export interface PendingItem {
  bet: Bet;
  /** what the connected user can do about it, if anything */
  myAction?: Exclude<ActionKind, "waiting">;
  label: string;
}

/** Everything not yet final, with what (if anything) `me` should do about it. */
export function pendingItems(ledger: Ledger, me: Address | undefined, nowSec: number): PendingItem[] {
  const items: PendingItem[] = [];
  for (const b of ledger.bets) {
    if (isExpired(b, nowSec)) continue;
    switch (b.status) {
      case Status.Proposed:
        items.push(
          me && sameAddress(b.taker, me)
            ? { bet: b, myAction: "accept", label: b.isDouble ? "Double or nothing offer" : "Accept or decline" }
            : { bet: b, label: `Waiting on ${memberName(ledger.members, b.taker)}` },
        );
        break;
      case Status.Claimed:
        items.push(
          me && isParty(b, me) && !sameAddress(b.claimant, me)
            ? { bet: b, myAction: "respond", label: "Your response needed" }
            : { bet: b, label: `${memberName(ledger.members, b.claimant)} claimed a result` },
        );
        break;
      case Status.Disputed:
        items.push(
          me && !isParty(b, me) && !ledger.myVotes.has(b.id)
            ? { bet: b, myAction: "vote", label: "Group vote open" }
            : { bet: b, label: "Group vote in progress" },
        );
        break;
      case Status.Resolved: {
        const winner = winnerOf(b);
        items.push(
          me && winner && sameAddress(winner, me)
            ? { bet: b, myAction: "markPaid", label: "You won — mark paid when settled" }
            : { bet: b, label: `Unpaid: ${memberName(ledger.members, loserOf(b))} owes ${memberName(ledger.members, winner)}` },
        );
        break;
      }
    }
  }
  return items.sort((a, b) => (a.myAction ? 0 : 1) - (b.myAction ? 0 : 1));
}

export function needsMyActionCount(ledger: Ledger, me: Address | undefined, nowSec: number): number {
  return pendingItems(ledger, me, nowSec).filter((i) => i.myAction).length;
}

/** Can `me` offer double-or-nothing on this bet right now? */
export function canDouble(bet: Bet, bets: Bet[], me: Address | undefined, nowSec: number): boolean {
  if (!me || bet.status !== Status.Resolved) return false;
  const winner = winnerOf(bet);
  if (!winner || !sameAddress(winner, me)) return false;
  if (bet.childId === (2n ** 256n - 1n)) return true;
  const child = bets[Number(bet.childId)];
  if (!child) return true;
  if (child.status === Status.Declined || child.status === Status.Canceled) return true;
  if (child.status === Status.Proposed && isExpired(child, nowSec)) return true;
  return false;
}
