import { useQuery } from "@tanstack/react-query";
import { numberToHex, pad, parseEventLogs, type Log } from "viem";
import { publicClient } from "./chain";
import { CONTRACT_ADDRESS, DEPLOY_BLOCK } from "./config";
import { betBookAbi } from "../generated";

export interface TimelineEvent {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
  blockNumber: bigint;
  timestamp: number;
}

/**
 * All of a bet's events share its id as the first indexed topic, so one
 * topic-filtered getLogs returns the full audit trail. Providers cap
 * eth_getLogs block ranges differently; on error we split the range and
 * recurse rather than hardcoding any provider's limit.
 */
async function getLogsAdaptive(topic: `0x${string}`, from: bigint, to: bigint, depth = 0): Promise<Log[]> {
  try {
    return await publicClient.request({
      method: "eth_getLogs",
      params: [
        {
          address: CONTRACT_ADDRESS,
          topics: [null, topic],
          fromBlock: numberToHex(from),
          toBlock: numberToHex(to),
        },
      ],
    }) as unknown as Log[];
  } catch (err) {
    if (depth >= 12 || to <= from) throw err;
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([
      getLogsAdaptive(topic, from, mid, depth + 1),
      getLogsAdaptive(topic, mid + 1n, to, depth + 1),
    ]);
    return [...a, ...b];
  }
}

async function fetchTimeline(betId: number): Promise<TimelineEvent[]> {
  const latest = await publicClient.getBlockNumber();
  const topic = pad(numberToHex(betId), { size: 32 });
  const logs = await getLogsAdaptive(topic, DEPLOY_BLOCK, latest);
  const parsed = parseEventLogs({ abi: betBookAbi, logs, strict: false });

  const blockNumbers = [...new Set(parsed.map((l) => l.blockNumber))];
  const stamps = new Map<bigint, number>();
  await Promise.all(
    blockNumbers.map(async (bn) => {
      const block = await publicClient.getBlock({ blockNumber: bn });
      stamps.set(bn, Number(block.timestamp));
    }),
  );

  return parsed
    .map((l) => ({
      name: l.eventName as string,
      args: l.args,
      blockNumber: l.blockNumber,
      timestamp: stamps.get(l.blockNumber) ?? 0,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function useTimeline(betId: number) {
  return useQuery({
    queryKey: ["timeline", betId],
    queryFn: () => fetchTimeline(betId),
  });
}
