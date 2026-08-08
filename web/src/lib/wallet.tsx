/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, encodeFunctionData, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useQueryClient } from "@tanstack/react-query";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { SmartWalletsProvider, useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { CHAIN, CONTRACT_ADDRESS, RPC_URL } from "./config";
import { publicClient } from "./chain";
import { betBookAbi } from "../generated";

/**
 * Wallet abstraction the whole app writes through.
 *
 * Without VITE_PRIVY_APP_ID (local dev): a persona switcher over anvil's
 * throwaway accounts, so the full lifecycle can be exercised in the browser
 * with no extension.
 *
 * With VITE_PRIVY_APP_ID (production): Privy email/Google login with an
 * embedded wallet wrapped in an ERC-4337 smart wallet; gas is sponsored by
 * the paymaster configured in the Privy dashboard. IMPORTANT: the address
 * exposed here is the SMART WALLET address — that is the on-chain member
 * identity, never the embedded EOA.
 */

const PRIVY_APP_ID: string | undefined = import.meta.env.VITE_PRIVY_APP_ID;

export interface Wallet {
  address?: Address;
  displayName?: string;
  personas?: { name: string; address: Address }[];
  personaIndex: number;
  setPersonaIndex: (i: number) => void;
  send: (functionName: string, args?: readonly unknown[]) => Promise<void>;
  login?: () => void;
  logout?: () => void;
}

const WalletContext = createContext<Wallet | null>(null);

export function useWallet(): Wallet {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <DevWalletProvider>{children}</DevWalletProvider>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: CHAIN,
        supportedChains: [CHAIN],
      }}
    >
      <SmartWalletsProvider>
        <PrivyWalletBridge>{children}</PrivyWalletBridge>
      </SmartWalletsProvider>
    </PrivyProvider>
  );
}

// ------------------------------------------------------------------ dev mode

// anvil's default funded accounts — dev only, publicly known keys
const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as const;
const PERSONA_NAMES = ["Timothy", "Alex", "Sam", "Priya"];

function DevWalletProvider({ children }: { children: ReactNode }) {
  const [personaIndex, setPersonaIndex] = useState(0);
  const queryClient = useQueryClient();

  const value = useMemo<Wallet>(() => {
    const accounts = ANVIL_KEYS.map((k) => privateKeyToAccount(k));
    const account = accounts[personaIndex];
    const client = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });
    return {
      address: account.address,
      displayName: PERSONA_NAMES[personaIndex],
      personas: accounts.map((a, i) => ({ name: PERSONA_NAMES[i], address: a.address })),
      personaIndex,
      setPersonaIndex,
      send: async (functionName, args = []) => {
        const hash = await client.writeContract({
          address: CONTRACT_ADDRESS,
          abi: betBookAbi,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          functionName: functionName as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          args: args as any,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        await queryClient.invalidateQueries();
      },
    };
  }, [personaIndex, queryClient]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

// ---------------------------------------------------------------- privy mode

function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { client } = useSmartWallets();
  const queryClient = useQueryClient();

  const address = client?.account.address as Address | undefined;

  const value = useMemo<Wallet>(
    () => ({
      address,
      displayName: user?.email?.address ?? user?.google?.email ?? undefined,
      personaIndex: 0,
      setPersonaIndex: () => {},
      login,
      logout,
      send: async (functionName, args = []) => {
        if (!client) throw new Error("wallet not ready");
        const hash = await client.sendTransaction({
          to: CONTRACT_ADDRESS,
          data: encodeFunctionData({
            abi: betBookAbi,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            functionName: functionName as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            args: args as any,
          }),
        });
        await publicClient.waitForTransactionReceipt({ hash });
        await queryClient.invalidateQueries();
      },
    }),
    [address, user, login, logout, client, queryClient],
  );

  if (!ready) return null;
  if (!authenticated)
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6">
        <span className="text-4xl">🎲</span>
        <h1 className="text-xl font-semibold">Squarebook</h1>
        <p className="text-sm text-neutral-500 text-center max-w-sm">
          Your friend group's tamper-proof bet ledger. Sign in with email — no crypto knowledge needed.
        </p>
        <button className="btn btn-primary" onClick={login}>
          Sign in
        </button>
      </div>
    );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
