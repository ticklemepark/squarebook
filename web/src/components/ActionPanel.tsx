import { useState } from "react";
import { Outcome, Status, stakeLabel, type Bet, type Ledger, sameAddress } from "../lib/types";
import { canDouble, isExpired, isParty, memberName, winnerOf } from "../lib/derive";
import { useWallet } from "../lib/wallet";
import { useSend } from "../lib/useSend";

const VOTE_WINDOW = 3 * 24 * 3600;

/** Contextual actions for a bet, derived from (status, connected address). */
export function ActionPanel({ bet, ledger }: { bet: Bet; ledger: Ledger }) {
  const { address: me } = useWallet();
  const { send, busy, error } = useSend();
  const [doubleTerms, setDoubleTerms] = useState("");
  const now = Math.floor(Date.now() / 1000);
  if (!me) return null;

  const id = BigInt(bet.id);
  const name = (a?: string) => memberName(ledger.members, a);
  const iAmMaker = sameAddress(bet.maker, me);
  const myWin = iAmMaker ? Outcome.MakerWins : Outcome.TakerWins;
  const theirWin = iAmMaker ? Outcome.TakerWins : Outcome.MakerWins;
  const act = (fn: string, args?: readonly unknown[]) => () => send(fn, args).catch(() => {});

  const buttons: React.ReactNode[] = [];

  if (bet.status === Status.Proposed && !isExpired(bet, now)) {
    if (sameAddress(bet.taker, me)) {
      buttons.push(
        <button key="a" className="btn btn-primary" disabled={busy} onClick={act("acceptBet", [id])}>
          Accept bet
        </button>,
        <button key="d" className="btn btn-danger" disabled={busy} onClick={act("declineBet", [id])}>
          Decline
        </button>,
      );
    }
    if (iAmMaker) {
      buttons.push(
        <button key="c" className="btn" disabled={busy} onClick={act("cancelBet", [id])}>
          Cancel proposal
        </button>,
      );
    }
  }

  if (bet.status === Status.Active && isParty(bet, me)) {
    buttons.push(
      <button key="w" className="btn btn-primary" disabled={busy} onClick={act("claimOutcome", [id, myWin])}>
        I won
      </button>,
      <button key="l" className="btn" disabled={busy} onClick={act("claimOutcome", [id, theirWin])}>
        {name(iAmMaker ? bet.taker : bet.maker)} won
      </button>,
      <button key="p" className="btn" disabled={busy} onClick={act("claimOutcome", [id, Outcome.Push])}>
        Call it a push
      </button>,
    );
  }

  if (bet.status === Status.Claimed && isParty(bet, me)) {
    if (!sameAddress(bet.claimant, me)) {
      const claimLabel =
        bet.claimedOutcome === Outcome.Push
          ? "a push"
          : bet.claimedOutcome === myWin
            ? `you won`
            : `they won`;
      buttons.push(
        <p key="ctx" className="w-full text-sm text-neutral-600">
          {name(bet.claimant)} says {claimLabel}.
        </p>,
        <button key="ag" className="btn btn-primary" disabled={busy} onClick={act("respondToClaim", [id, bet.claimedOutcome])}>
          Agree
        </button>,
      );
      if (bet.claimedOutcome !== myWin)
        buttons.push(
          <button key="dm" className="btn btn-danger" disabled={busy} onClick={act("respondToClaim", [id, myWin])}>
            Dispute — I won
          </button>,
        );
      if (bet.claimedOutcome !== Outcome.Push)
        buttons.push(
          <button key="dp" className="btn" disabled={busy} onClick={act("respondToClaim", [id, Outcome.Push])}>
            Dispute — it's a push
          </button>,
        );
    } else {
      const canEscalate = now > Number(bet.claimedAt) + VOTE_WINDOW;
      buttons.push(
        <p key="ctx" className="w-full text-sm text-neutral-600">
          Waiting for {name(iAmMaker ? bet.taker : bet.maker)} to respond to your claim.
        </p>,
        <button key="es" className="btn" disabled={busy || !canEscalate} onClick={act("escalate", [id])}>
          {canEscalate ? "Escalate to group vote" : "Can escalate after 3 days of silence"}
        </button>,
      );
    }
  }

  if (bet.status === Status.Disputed) {
    const canVote = !isParty(bet, me) && !ledger.myVotes.has(bet.id);
    if (canVote) {
      buttons.push(
        <button key="vm" className="btn" disabled={busy} onClick={act("vote", [id, Outcome.MakerWins])}>
          {name(bet.maker)} won
        </button>,
        <button key="vt" className="btn" disabled={busy} onClick={act("vote", [id, Outcome.TakerWins])}>
          {name(bet.taker)} won
        </button>,
        <button key="vp" className="btn" disabled={busy} onClick={act("vote", [id, Outcome.Push])}>
          Push / void
        </button>,
      );
    }
    buttons.push(
      <button key="f" className="btn" disabled={busy} onClick={act("finalizeVote", [id])}>
        Finalize vote
      </button>,
    );
  }

  if (bet.status === Status.Resolved) {
    const winner = winnerOf(bet);
    if (winner && sameAddress(winner, me)) {
      buttons.push(
        <button key="mp" className="btn btn-primary" disabled={busy} onClick={act("markSettled", [id])}>
          Mark paid
        </button>,
      );
    }
  }

  const showDouble = canDouble(bet, ledger.bets, me, now);

  if (buttons.length === 0 && !showDouble) return null;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">{buttons}</div>
      {showDouble && (
        <div className="border border-neutral-300 rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium">Double or nothing</p>
          <p className="text-sm text-neutral-600">
            Risk your winnings on a rematch. Win: {name(iAmMaker ? bet.taker : bet.maker)} owes{" "}
            {stakeLabel(bet.stakeQty * 2, bet.stakeUnit)}. Lose: nobody owes anything. They must accept first.
          </p>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
              placeholder="New terms, e.g. rematch next Thursday"
              value={doubleTerms}
              onChange={(e) => setDoubleTerms(e.target.value)}
            />
            <button
              className="btn"
              disabled={busy || !doubleTerms.trim()}
              onClick={act("proposeDoubleOrNothing", [id, doubleTerms.trim(), BigInt(now + 7 * 24 * 3600)])}
            >
              Propose {stakeLabel(bet.stakeQty, bet.stakeUnit)} → {stakeLabel(bet.stakeQty * 2, bet.stakeUnit)}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
