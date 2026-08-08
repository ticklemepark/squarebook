import type { Address } from "viem";

export const Status = {
  None: 0,
  Proposed: 1,
  Active: 2,
  Claimed: 3,
  Disputed: 4,
  Resolved: 5,
  Settled: 6,
  Declined: 7,
  Canceled: 8,
  Superseded: 9,
} as const;
export type StatusValue = (typeof Status)[keyof typeof Status];

export const Outcome = {
  None: 0,
  MakerWins: 1,
  TakerWins: 2,
  Push: 3,
} as const;
export type OutcomeValue = (typeof Outcome)[keyof typeof Outcome];

export const NO_BET = 2n ** 256n - 1n;

export interface Bet {
  id: number;
  maker: Address;
  taker: Address;
  description: string;
  stakeQty: number;
  stakeUnit: string;
  acceptBy: bigint;
  claimedAt: bigint;
  disputedAt: bigint;
  status: StatusValue;
  claimedOutcome: OutcomeValue;
  claimant: Address;
  outcome: OutcomeValue;
  votesMaker: number;
  votesTaker: number;
  votesPush: number;
  parentId: bigint;
  childId: bigint;
  isDouble: boolean;
}

export interface Member {
  address: Address;
  name: string;
  joinedAt: bigint;
}

export interface Ledger {
  bets: Bet[];
  members: Member[];
  /** bet ids the connected account has already voted on */
  myVotes: Set<number>;
}

export function stakeLabel(qty: number, unit: string): string {
  if (unit === "USD") return `$${qty}`;
  return `${qty} × ${unit}`;
}

export function sameAddress(a?: string, b?: string): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
