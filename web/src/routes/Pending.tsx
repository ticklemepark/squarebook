import { pendingItems } from "../lib/derive";
import { useLedger } from "../lib/useLedger";
import { useWallet } from "../lib/wallet";
import { BetCard } from "../components/BetCard";

export function Pending() {
  const { address: me } = useWallet();
  const { data: ledger, isLoading } = useLedger(me);
  if (isLoading || !ledger) return <p className="py-6 text-sm text-neutral-500">Loading…</p>;

  const items = pendingItems(ledger, me, Math.floor(Date.now() / 1000));
  const mine = items.filter((i) => i.myAction);
  const theirs = items.filter((i) => !i.myAction);

  return (
    <div className="py-4 space-y-4">
      {mine.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500 mb-2">Needs your action</h2>
          <div className="card">
            {mine.map((i) => (
              <BetCard key={i.bet.id} bet={i.bet} members={ledger.members} note={i.label} />
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="text-sm font-medium text-neutral-500 mb-2">Waiting on others</h2>
        <div className="card">
          {theirs.length === 0 && <p className="p-4 text-sm text-neutral-500">Nothing here.</p>}
          {theirs.map((i) => (
            <BetCard key={i.bet.id} bet={i.bet} members={ledger.members} note={i.label} />
          ))}
        </div>
      </section>
    </div>
  );
}
