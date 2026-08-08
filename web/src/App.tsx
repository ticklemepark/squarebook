import { NavLink, Route, Routes } from "react-router-dom";
import { needsMyActionCount } from "./lib/derive";
import { useLedger } from "./lib/useLedger";
import { useWallet } from "./lib/wallet";
import { Chat } from "./routes/Chat";
import { Pending } from "./routes/Pending";
import { Balances } from "./routes/Balances";
import { BetDetail } from "./routes/BetDetail";
import { Members } from "./routes/Members";

function Header() {
  const wallet = useWallet();
  const { data: ledger } = useLedger(wallet.address);
  const count = ledger ? needsMyActionCount(ledger, wallet.address, Math.floor(Date.now() / 1000)) : 0;

  const tab = ({ isActive }: { isActive: boolean }) =>
    `px-1 pb-1.5 text-sm border-b-2 ${isActive ? "border-neutral-900 text-neutral-900 font-medium" : "border-transparent text-neutral-500 hover:text-neutral-800"}`;

  return (
    <header className="sticky top-0 bg-neutral-100/90 backdrop-blur border-b border-neutral-200 z-10">
      <div className="max-w-2xl mx-auto px-4 pt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 pb-2">
          <span className="text-lg">🎲</span>
          <span className="font-semibold">Squarebook</span>
        </div>
        <nav className="flex items-end gap-4">
          <NavLink to="/" end className={tab}>
            Chat
          </NavLink>
          <NavLink to="/pending" className={tab}>
            Pending
            {count > 0 && (
              <span className="ml-1 rounded-full bg-amber-200 text-amber-900 text-[11px] px-1.5 py-0.5">{count}</span>
            )}
          </NavLink>
          <NavLink to="/balances" className={tab}>
            Balances
          </NavLink>
          <NavLink to="/members" className={tab}>
            Members
          </NavLink>
        </nav>
        <div className="pb-2">
          {wallet.personas ? (
            <select
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm"
              value={wallet.personaIndex}
              onChange={(e) => wallet.setPersonaIndex(Number(e.target.value))}
              title="Dev persona switcher (anvil accounts)"
            >
              {wallet.personas.map((p, i) => (
                <option key={p.address} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <button
                className="text-xs font-mono text-neutral-500 hover:text-neutral-800 cursor-pointer"
                title="Copy your wallet address (send it to a member to get added)"
                onClick={() => wallet.address && navigator.clipboard.writeText(wallet.address)}
              >
                {wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)} ⧉` : "—"}
              </button>
              {wallet.logout && (
                <button className="text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer" onClick={wallet.logout}>
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-dvh">
      <Header />
      <main className="max-w-2xl mx-auto px-4">
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/pending" element={<Pending />} />
          <Route path="/balances" element={<Balances />} />
          <Route path="/bet/:id" element={<BetDetail />} />
          <Route path="/members" element={<Members />} />
        </Routes>
      </main>
    </div>
  );
}
