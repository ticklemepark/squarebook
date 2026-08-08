import { useState } from "react";
import { useWallet } from "./wallet";

/** Wraps wallet.send with busy/error state for action buttons. */
export function useSend() {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function send(functionName: string, args?: readonly unknown[]) {
    setBusy(true);
    setError(undefined);
    try {
      await wallet.send(functionName, args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const revert = msg.match(/reverted with the following reason:\s*\n?\s*(.+?)\n/);
      setError(revert ? revert[1] : msg.split("\n")[0]);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  return { send, busy, error };
}
