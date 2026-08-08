import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { publicClient } from "./chain";
import { CONTRACT_ADDRESS } from "./config";
import { betBookAbi } from "../generated";
import { Status, type Bet, type Ledger, type Member } from "./types";

function read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
  return publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: betBookAbi,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functionName: functionName as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
  }) as Promise<T>;
}

async function fetchLedger(me?: Address): Promise<Ledger> {
  const [betCount, memberCount] = await Promise.all([
    read<bigint>("betCount"),
    read<bigint>("memberCount"),
  ]);

  const betIds = [...Array(Number(betCount)).keys()];
  const memberIdx = [...Array(Number(memberCount)).keys()];

  const [rawBets, memberAddrs] = await Promise.all([
    Promise.all(betIds.map((i) => read<Omit<Bet, "id">>("getBet", [BigInt(i)]))),
    Promise.all(memberIdx.map((i) => read<Address>("memberList", [BigInt(i)]))),
  ]);

  const bets: Bet[] = rawBets.map((b, i) => ({ ...b, id: i }));

  const members: Member[] = await Promise.all(
    memberAddrs.map(async (address) => {
      const [name, joinedAt] = await read<[string, bigint, boolean]>("members", [address]);
      return { address, name, joinedAt };
    }),
  );

  const myVotes = new Set<number>();
  if (me) {
    const disputed = bets.filter((b) => b.status === Status.Disputed);
    const voted = await Promise.all(
      disputed.map((b) => read<boolean>("hasVoted", [BigInt(b.id), me])),
    );
    disputed.forEach((b, i) => {
      if (voted[i]) myVotes.add(b.id);
    });
  }

  return { bets, members, myVotes };
}

export function useLedger(me?: Address) {
  return useQuery({
    queryKey: ["ledger", me?.toLowerCase() ?? "anon"],
    queryFn: () => fetchLedger(me),
    refetchInterval: 15_000,
  });
}
