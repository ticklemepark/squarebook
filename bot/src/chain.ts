import { createPublicClient, http, type Address } from "viem";
import { CHAIN, RPC_URL, contractAddress } from "./config";
import { betBookAbi } from "../../web/src/generated";
import { Status, type Bet, type Ledger, type Member } from "../../web/src/lib/types";

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
export { betBookAbi };

export function read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
  return publicClient.readContract({
    address: contractAddress(),
    abi: betBookAbi,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functionName: functionName as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
  }) as Promise<T>;
}

/** Same shape the web app uses, so the shared derive helpers work verbatim. */
export async function fetchLedger(me?: Address): Promise<Ledger> {
  const [betCount, memberCount] = await Promise.all([
    read<bigint>("betCount"),
    read<bigint>("memberCount"),
  ]);

  const [rawBets, memberAddrs] = await Promise.all([
    Promise.all(
      [...Array(Number(betCount)).keys()].map((i) => read<Omit<Bet, "id">>("getBet", [BigInt(i)])),
    ),
    Promise.all([...Array(Number(memberCount)).keys()].map((i) => read<Address>("memberList", [BigInt(i)]))),
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
    const voted = await Promise.all(disputed.map((b) => read<boolean>("hasVoted", [BigInt(b.id), me])));
    disputed.forEach((b, i) => {
      if (voted[i]) myVotes.add(b.id);
    });
  }

  return { bets, members, myVotes };
}
