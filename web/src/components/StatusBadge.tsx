import { Status, type Bet } from "../lib/types";
import { isExpired } from "../lib/derive";

const STYLES: Record<number, [string, string]> = {
  [Status.Proposed]: ["Proposed", "bg-amber-100 text-amber-800"],
  [Status.Active]: ["Active", "bg-blue-100 text-blue-800"],
  [Status.Claimed]: ["Awaiting response", "bg-amber-100 text-amber-800"],
  [Status.Disputed]: ["Group vote", "bg-red-100 text-red-800"],
  [Status.Resolved]: ["Unpaid", "bg-purple-100 text-purple-800"],
  [Status.Settled]: ["Settled", "bg-green-100 text-green-800"],
  [Status.Declined]: ["Declined", "bg-neutral-200 text-neutral-600"],
  [Status.Canceled]: ["Canceled", "bg-neutral-200 text-neutral-600"],
  [Status.Superseded]: ["Doubled", "bg-purple-100 text-purple-800"],
};

export function StatusBadge({ bet }: { bet: Bet }) {
  const now = Math.floor(Date.now() / 1000);
  if (isExpired(bet, now)) return <span className="badge bg-neutral-200 text-neutral-600">Expired</span>;
  const [label, cls] = STYLES[bet.status] ?? ["?", "bg-neutral-200 text-neutral-600"];
  return <span className={`badge ${cls}`}>{label}</span>;
}
