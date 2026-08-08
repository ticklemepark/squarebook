import "dotenv/config";
import { defineChain } from "viem";
import { baseSepolia } from "viem/chains";

const env = process.env;

export const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export const RPC_URL = env.RPC_URL ?? "http://127.0.0.1:8545";
export const CHAIN = Number(env.CHAIN_ID ?? 31337) === baseSepolia.id ? baseSepolia : anvil;

export function contractAddress(): `0x${string}` {
  // read lazily so test harnesses can set the env var at runtime
  return (process.env.CONTRACT_ADDRESS ?? "0x5FbDB2315678afecb367f032d93F642f64180aa3") as `0x${string}`;
}

/** Derives every user's signing key — treat like a master password. */
export const MASTER_SEED = env.MASTER_SEED ?? "dev-only-insecure-seed";

/** Pays gas top-ups for derived accounts. Defaults to anvil account #0. */
export const FUNDER_KEY = (env.FUNDER_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;

export const EXPLORER_URL = CHAIN.id === baseSepolia.id ? "https://sepolia.basescan.org" : undefined;

export const DISCORD_TOKEN = env.DISCORD_TOKEN;
export const DISCORD_APP_ID = env.DISCORD_APP_ID;
export const GUILD_ID = env.GUILD_ID;
export const CHANNEL_ID = env.CHANNEL_ID;
