import { Link } from "react-router-dom";
import { stakeLabel, type Bet, type Member } from "../lib/types";
import { memberName } from "../lib/derive";
import { StatusBadge } from "./StatusBadge";

export function BetCard({ bet, members, note }: { bet: Bet; members: Member[]; note?: string }) {
  return (
    <Link
      to={`/bet/${bet.id}`}
      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50 border-b border-neutral-100 last:border-b-0"
    >
      <div className="min-w-0">
        <p className="text-[15px] truncate">
          {bet.description} · <span className="font-medium">{stakeLabel(bet.stakeQty, bet.stakeUnit)}</span>
          {bet.isDouble && <span className="ml-1 text-purple-700 text-xs font-medium">2×</span>}
        </p>
        <p className="text-xs text-neutral-500 mt-0.5">
          {memberName(members, bet.maker)} vs {memberName(members, bet.taker)}
          {note ? ` · ${note}` : ""}
        </p>
      </div>
      <StatusBadge bet={bet} />
    </Link>
  );
}
