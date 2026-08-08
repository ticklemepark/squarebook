import { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { stakeLabel, sameAddress } from "../lib/types";
import {
  CANONICAL_UNITS,
  GREETING,
  chatReduce,
  type BotReply,
  type ChatState,
  type Draft,
} from "../lib/chatFlow";
import { netByUnit, openDebts, pendingItems } from "../lib/derive";
import { useLedger } from "../lib/useLedger";
import { useWallet } from "../lib/wallet";
import { useSend } from "../lib/useSend";
import { StatusBadge } from "../components/StatusBadge";

interface Msg {
  from: "bot" | "me";
  text?: string;
  reply?: BotReply;
}

export function Chat() {
  const { address: me } = useWallet();
  const { data: ledger } = useLedger(me);
  const { send, busy } = useSend();
  const [msgs, setMsgs] = useState<Msg[]>([{ from: "bot", text: GREETING }]);
  const [chatState, setChatState] = useState<ChatState>({ step: "idle" });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const members = ledger?.members ?? [];

  async function propose(draft: Required<Draft>) {
    const acceptBy = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600);
    try {
      await send("proposeBet", [draft.taker, draft.description, draft.qty, draft.unit, acceptBy]);
      setMsgs((m) => [
        ...m,
        { from: "bot", text: `Sent. Waiting for ${draft.takerName} to accept — you'll see it under Pending.` },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      setMsgs((m) => [...m, { from: "bot", text: `That didn't go through: ${msg}` }]);
    }
  }

  function submit(text: string, echo = true) {
    if (!text.trim() || busy) return;
    const result = chatReduce(chatState, text, members, me);
    setChatState(result.state);
    setMsgs((m) => [
      ...m,
      ...(echo ? [{ from: "me", text } as Msg] : []),
      ...result.replies.map((reply): Msg => ({ from: "bot", reply })),
    ]);
    setInput("");
    if (result.effect?.type === "propose") void propose(result.effect.draft);
  }

  function renderReply(reply: BotReply) {
    switch (reply.kind) {
      case "text":
        return <div className="bubble-bot">{reply.text}</div>;
      case "memberChips":
        return (
          <div className="flex flex-wrap gap-1.5 self-start">
            {members
              .filter((m) => !sameAddress(m.address, me))
              .map((m) => (
                <button key={m.address} className="chip" onClick={() => submit(m.name)}>
                  {m.name}
                </button>
              ))}
          </div>
        );
      case "unitChips":
        return (
          <div className="flex flex-wrap gap-1.5 self-start">
            {CANONICAL_UNITS.map((u) => (
              <button
                key={u}
                className="chip"
                onClick={() => {
                  setInput(u === "USD" ? "$20" : `2 ${u}`);
                  inputRef.current?.focus();
                }}
              >
                {u === "USD" ? "$ cash" : u}
              </button>
            ))}
          </div>
        );
      case "confirm":
        return (
          <div className="self-start border border-neutral-300 rounded-xl p-3.5 w-full max-w-[85%] bg-white">
            <p className="text-sm text-neutral-500 mb-2">Review your bet</p>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="text-neutral-500 py-0.5">With</td>
                  <td className="text-right">{reply.draft.takerName}</td>
                </tr>
                <tr>
                  <td className="text-neutral-500 py-0.5">Terms</td>
                  <td className="text-right">{reply.draft.description}</td>
                </tr>
                <tr>
                  <td className="text-neutral-500 py-0.5">Stake</td>
                  <td className="text-right font-medium">{stakeLabel(reply.draft.qty, reply.draft.unit)}</td>
                </tr>
              </tbody>
            </table>
            <div className="flex gap-2 mt-3">
              <button className="btn btn-primary" disabled={busy} onClick={() => submit("__send__", false)}>
                Send bet
              </button>
              <button className="btn" disabled={busy} onClick={() => submit("cancel", false)}>
                Cancel
              </button>
            </div>
          </div>
        );
      case "showPending": {
        if (!ledger) return <div className="bubble-bot">Still loading the ledger…</div>;
        const items = pendingItems(ledger, me, Math.floor(Date.now() / 1000)).slice(0, 5);
        return (
          <div className="self-start card w-full max-w-[85%] divide-y divide-neutral-100">
            {items.length === 0 && <p className="p-3 text-sm text-neutral-500">Nothing pending.</p>}
            {items.map((i) => (
              <Link key={i.bet.id} to={`/bet/${i.bet.id}`} className="flex justify-between gap-2 p-3 text-sm hover:bg-neutral-50">
                <span className="truncate">{i.bet.description}</span>
                <StatusBadge bet={i.bet} />
              </Link>
            ))}
            <Link to="/pending" className="block p-2.5 text-center text-sm text-blue-700">
              See all pending
            </Link>
          </div>
        );
      }
      case "showBalances": {
        if (!ledger || !me) return <div className="bubble-bot">Still loading the ledger…</div>;
        const net = [...netByUnit(openDebts(ledger.bets), me).entries()].filter(([, v]) => v !== 0);
        return (
          <div className="self-start card w-full max-w-[85%] p-3">
            {net.length === 0 ? (
              <p className="text-sm text-neutral-500">All square — no open debts.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {net.map(([unit, qty]) => (
                  <li key={unit} className={qty > 0 ? "text-green-700" : "text-red-700"}>
                    {qty > 0 ? "+" : "−"}
                    {stakeLabel(Math.abs(qty), unit)} {qty > 0 ? "owed to you" : "you owe"}
                  </li>
                ))}
              </ul>
            )}
            <Link to="/balances" className="block pt-2 text-sm text-blue-700">
              Full balances
            </Link>
          </div>
        );
      }
    }
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-7rem)]">
      <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 py-4">
        {msgs.map((m, i) => (
          <div key={i} className="flex flex-col">
            {m.from === "me" ? <div className="bubble-me">{m.text}</div> : m.reply ? renderReply(m.reply) : <div className="bubble-bot">{m.text}</div>}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        className="flex gap-2 pt-2 border-t border-neutral-200"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input
          ref={inputRef}
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[15px]"
          placeholder='New bet, or try "pending" or "balance"'
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
