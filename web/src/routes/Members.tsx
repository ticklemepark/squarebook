import { useState } from "react";
import { isAddress } from "viem";
import { useLedger } from "../lib/useLedger";
import { useWallet } from "../lib/wallet";
import { useSend } from "../lib/useSend";

export function Members() {
  const { address: me } = useWallet();
  const { data: ledger, isLoading } = useLedger(me);
  const { send, busy, error } = useSend();
  const [addr, setAddr] = useState("");
  const [name, setName] = useState("");
  if (isLoading || !ledger) return <p className="py-6 text-sm text-neutral-500">Loading…</p>;

  const valid = isAddress(addr) && name.trim().length > 0;

  return (
    <div className="py-4 space-y-4">
      <div className="card divide-y divide-neutral-100">
        {ledger.members.map((m) => (
          <div key={m.address} className="flex items-center gap-3 px-4 py-3">
            <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center text-xs font-medium">
              {m.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-medium">
                {m.name}
                {me?.toLowerCase() === m.address.toLowerCase() && (
                  <span className="ml-1.5 text-xs text-neutral-400">you</span>
                )}
              </p>
              <p className="text-xs text-neutral-400 font-mono truncate">{m.address}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-4 space-y-2">
        <h2 className="text-sm font-medium">Add a member</h2>
        <p className="text-sm text-neutral-500">
          Ask your friend to log in first, copy their wallet address from the header, and send it to you.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-mono"
            placeholder="0x…"
            value={addr}
            onChange={(e) => setAddr(e.target.value.trim())}
          />
          <input
            className="sm:w-40 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={!valid || busy}
            onClick={() =>
              send("addMember", [addr as `0x${string}`, name.trim()])
                .then(() => {
                  setAddr("");
                  setName("");
                })
                .catch(() => {})
            }
          >
            Add member
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
