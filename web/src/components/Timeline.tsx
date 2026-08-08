import { useTimeline } from "../lib/timeline";
import { Outcome, type Member } from "../lib/types";
import { memberName } from "../lib/derive";

const OUTCOME_LABEL: Record<number, string> = {
  [Outcome.MakerWins]: "maker wins",
  [Outcome.TakerWins]: "taker wins",
  [Outcome.Push]: "push",
};

export function Timeline({ betId, members }: { betId: number; members: Member[] }) {
  const { data: events, isLoading } = useTimeline(betId);
  if (isLoading) return <p className="text-sm text-neutral-500">Loading history…</p>;
  if (!events?.length) return null;

  const name = (a?: string) => memberName(members, a);
  const line = (e: (typeof events)[number]): string => {
    const a = e.args ?? {};
    switch (e.name) {
      case "BetProposed":
        return a.parentId !== undefined && a.parentId !== 2n ** 256n - 1n
          ? `${name(a.maker)} proposed double or nothing to ${name(a.taker)}`
          : `${name(a.maker)} proposed the bet to ${name(a.taker)}`;
      case "BetAccepted":
        return "Bet accepted — game on";
      case "BetDeclined":
        return "Proposal declined";
      case "BetCanceled":
        return "Proposal canceled";
      case "OutcomeClaimed":
        return `${name(a.claimant)} claimed: ${OUTCOME_LABEL[Number(a.outcome)] ?? "?"}`;
      case "ClaimDisputed":
        return `${name(a.disputer)} disagreed — group vote opened`;
      case "VoteCast":
        return `${name(a.voter)} voted: ${OUTCOME_LABEL[Number(a.outcome)] ?? "?"}`;
      case "BetResolved":
        return `Resolved ${a.byVote ? "by group vote" : "by mutual agreement"}: ${OUTCOME_LABEL[Number(a.outcome)] ?? "?"}`;
      case "BetSettled":
        return a.markedBy && a.markedBy !== "0x0000000000000000000000000000000000000000"
          ? `${name(a.markedBy)} marked the debt paid`
          : "Auto-settled — nothing owed";
      case "BetSuperseded":
        return "Doubled — the debt now rides on the rematch";
      case "ParentRestored":
        return "Rematch voided — original debt stands";
      default:
        return e.name;
    }
  };

  return (
    <ol className="space-y-2">
      {events.map((e, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="text-neutral-400 tabular-nums shrink-0">
            {new Date(e.timestamp * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
          <span>{line(e)}</span>
        </li>
      ))}
    </ol>
  );
}
