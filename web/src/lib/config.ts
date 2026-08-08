import { defineChain } from "viem";
import { baseSepolia } from "viem/chains";

export const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

const env = import.meta.env;

export const RPC_URL: string = env.VITE_RPC_URL ?? "http://127.0.0.1:8545";
export const CHAIN = Number(env.VITE_CHAIN_ID ?? 31337) === baseSepolia.id ? baseSepolia : anvil;
// First contract deployed by anvil account #0 always lands at this address.
export const CONTRACT_ADDRESS = (env.VITE_CONTRACT_ADDRESS ??
  "0x5FbDB2315678afecb367f032d93F642f64180aa3") as `0x${string}`;
export const DEPLOY_BLOCK = BigInt(env.VITE_DEPLOY_BLOCK ?? 0);
export const EXPLORER_URL: string | undefined =
  CHAIN.id === baseSepolia.id ? "https://sepolia.basescan.org" : undefined;
