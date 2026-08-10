import { keccak256, stringToBytes } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { MASTER_SEED } from "./config";

/**
 * Deterministically derives a signing key for a messaging-platform user id
 * (iMessage phone number / email handle, Discord snowflake, …) from the
 * master seed. One-way: knowing an address reveals nothing; knowing the seed
 * recovers every key (which is also the backup story — the seed IS the
 * custody). This is the "version 2" trust model: the bot operator can sign
 * for anyone, the chain is a tamper-evident public log, and honesty is
 * enforced by every action being broadcast to the group.
 */
export function accountFor(userId: string): PrivateKeyAccount {
  const pk = keccak256(stringToBytes(`${MASTER_SEED}|user|${userId}`));
  return privateKeyToAccount(pk);
}
