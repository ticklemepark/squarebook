import { Link, useParams } from "react-router-dom";
import { NO_BET, Status, stakeLabel } from "../lib/types";
import { memberName } from "../lib/derive";
import { useLedger } from "../lib/useLedger";
import { useWallet } from "../lib/wallet";
import { ActionPanel } from "../components/ActionPanel";
import { StatusBadge } from "../components/StatusBadge";
import { Timeline } from "../components/Timeline";

export function BetDetail() {
  const { id } = useParams();
  const { address: me } = useWallet();
  const { data: ledger, isLoading } = useLedger(me);
  if (isLoading || !ledger) return <p className="py-6 text-sm text-neutral-500">Loading…</p>;

  const bet = ledger.bets[Number(id)];
  if (!bet) return <p className="py-6 text-sm text-neutral-500">No such bet.</p>;

  const votesTotal = bet.votesMaker + bet.votesTaker + bet.votesPush;

  return (
    <div className="py-4 space-y-4">
      <div className="card p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[17px] font-medium">{bet.description}</p>
            <p className="text-sm text-neutral-500 mt-0.5">
              {memberName(ledger.members, bet.maker)} vs {memberName(ledger.members, bet.taker)} · stake{" "}
              <span className="font-medium text-neutral-800">{stakeLabel(bet.stakeQty, bet.stakeUnit)}</span>
            </p>
          </div>
          <StatusBadge bet={bet} />
        </div>
        {bet.isDouble && bet.parentId !== NO_BET && (
          <p className="text-sm text-purple-700">
            Double or nothing on{" "}
            <Link to={`/bet/${bet.parentId}`} className="underline">
              bet #{bet.parentId.toString()}
            </Link>
          </p>
        )}
        {bet.childId !== NO_BET && (
          <p className="text-sm text-purple-700">
            Rematch:{" "}
            <Link to={`/bet/${bet.childId}`} className="underline">
              bet #{bet.childId.toString()}
            </Link>
          </p>
        )}
        {bet.status === Status.Disputed && (
          <p className="text-sm text-neutral-600">
            Votes — {memberName(ledger.members, bet.maker)}: {bet.votesMaker} ·{" "}
            {memberName(ledger.members, bet.taker)}: {bet.votesTaker} · push: {bet.votesPush}
            {votesTotal === 0 ? " (no votes yet)" : ""}
          </p>
        )}
      </div>

      <ActionPanel bet={bet} ledger={ledger} />

      <div className="card p-4">
        <h2 className="text-sm font-medium text-neutral-500 mb-3">History</h2>
        <Timeline betId={bet.id} members={ledger.members} />
      </div>
    </div>
  );
}
