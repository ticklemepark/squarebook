import { createPublicClient, http } from "viem";
import { CHAIN, RPC_URL } from "./config";

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});
