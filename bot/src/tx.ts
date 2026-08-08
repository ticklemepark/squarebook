import { BaseError, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, FUNDER_KEY, RPC_URL, contractAddress } from "./config";
import { betBookAbi, publicClient } from "./chain";
import { accountFor } from "./keys";
import { recordUser } from "./users";

// Base Sepolia gas is ~fractions of a microcent per tx, so faucet-sized
// funder balances go a long way. Overridable for other chains.
const MIN_BALANCE = parseEther(process.env.MIN_BALANCE_ETH ?? "0.00001");
const TOP_UP = parseEther(process.env.TOP_UP_ETH ?? "0.00005");

async function ensureFunded(address: `0x${string}`) {
  const balance = await publicClient.getBalance({ address });
  if (balance >= MIN_BALANCE) return;
  const funder = createWalletClient({
    account: privateKeyToAccount(FUNDER_KEY),
    chain: CHAIN,
    transport: http(RPC_URL),
  });
  const hash = await funder.sendTransaction({ to: address, value: TOP_UP });
  await publicClient.waitForTransactionReceipt({ hash });
}

/** Sign and send a contract call as a Discord user's derived account. */
export async function sendAs(discordId: string, functionName: string, args: readonly unknown[] = []) {
  recordUser(discordId);
  const account = accountFor(discordId);
  await ensureFunded(account.address);
  const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });
  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: contractAddress(),
      abi: betBookAbi,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      functionName: functionName as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args: args as any,
    });
    const hash = await wallet.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  } catch (err) {
    if (err instanceof BaseError) throw new Error(err.shortMessage.replace(/^.*reason:\s*/s, ""));
    throw err;
  }
}
