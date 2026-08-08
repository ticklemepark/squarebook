import { Link } from "react-router-dom";
import { stakeLabel, sameAddress } from "../lib/types";
import { memberName, netByUnit, openDebts, pairwiseDebts } from "../lib/derive";
import { useLedger } from "../lib/useLedger";
import { useWallet } from "../lib/wallet";
import { useSend } from "../lib/useSend";

export function Balances() {
  const { address: me } = useWallet();
  const { data: ledger, isLoading } = useLedger(me);
  const { send, busy, error } = useSend();
  if (isLoading || !ledger || !me) return <p className="py-6 text-sm text-neutral-500">Loading…</p>;

  const debts = openDebts(ledger.bets);
  const net = [...netByUnit(debts, me).entries()].filter(([, v]) => v !== 0);
  const pairs = pairwiseDebts(debts).filter(
    (p) => sameAddress(p.debtor, me) || sameAddress(p.creditor, me),
  );
  const others = pairwiseDebts(debts).filter(
    (p) => !sameAddress(p.debtor, me) && !sameAddress(p.creditor, me),
  );

  return (
    <div className="py-4 space-y-4">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {net.length === 0 && <p className="col-span-full text-sm text-neutral-500">All square — no open debts.</p>}
        {net.map(([unit, qty]) => (
          <div key={unit} className="card p-3">
            <p className="text-xs text-neutral-500">{unit === "USD" ? "cash" : unit}</p>
            <p className={`text-2xl font-medium ${qty > 0 ? "text-green-700" : "text-red-700"}`}>
              {qty > 0 ? "+" : "−"}
              {unit === "USD" ? `$${Math.abs(qty)}` : Math.abs(qty)}
            </p>
          </div>
        ))}
      </section>

      <section className="card divide-y divide-neutral-100">
        {pairs.length === 0 && <p className="p-4 text-sm text-neutral-500">No open debts involving you.</p>}
        {pairs.map((p) => {
          const iAmCreditor = sameAddress(p.creditor, me);
          return (
            <div key={`${p.debtor}-${p.creditor}-${p.unit}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-[15px]">
                {iAmCreditor ? (
                  <>
                    {memberName(ledger.members, p.debtor)} owes you{" "}
                    <span className="font-medium">{stakeLabel(p.qty, p.unit)}</span>
                  </>
                ) : (
                  <>
                    You owe {memberName(ledger.members, p.creditor)}{" "}
                    <span className="font-medium">{stakeLabel(p.qty, p.unit)}</span>
                  </>
                )}
              </p>
              {iAmCreditor ? (
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {p.betIds.map((id) => (
                    <button
                      key={id}
                      className="btn text-xs"
                      disabled={busy}
                      onClick={() => send("markSettled", [BigInt(id)]).catch(() => {})}
                    >
                      Mark #{id} paid
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-neutral-400">
                  {memberName(ledger.members, p.creditor)} marks paid
                </span>
              )}
            </div>
          );
        })}
        {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
      </section>

      {others.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500 mb-2">Around the group</h2>
          <div className="card divide-y divide-neutral-100">
            {others.map((p) => (
              <p key={`${p.debtor}-${p.creditor}-${p.unit}`} className="px-4 py-2.5 text-sm text-neutral-600">
                {memberName(ledger.members, p.debtor)} owes {memberName(ledger.members, p.creditor)}{" "}
                {stakeLabel(p.qty, p.unit)}{" "}
                <Link to={`/bet/${p.betIds[0]}`} className="text-blue-700">
                  view
                </Link>
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
