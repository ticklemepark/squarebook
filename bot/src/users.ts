import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accountFor } from "./keys";

/**
 * Reverse index address -> Discord id so the event watcher can DM people.
 * Populated automatically the first time a user is seen (mentioned or
 * interacting). JSON file is plenty for a friend group.
 */

const DATA_DIR = process.env.BOT_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = join(DATA_DIR, "users.json");

let cache: Record<string, string> | undefined; // discordId -> address

function load(): Record<string, string> {
  if (!cache) {
    cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
  }
  return cache!;
}

export function recordUser(discordId: string): `0x${string}` {
  const users = load();
  const address = accountFor(discordId).address;
  if (users[discordId] !== address) {
    users[discordId] = address;
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(users, null, 2));
  }
  return address;
}

export function allUsers(): Record<string, string> {
  return { ...load() };
}

export function discordIdFor(address: string): string | undefined {
  const users = load();
  const lower = address.toLowerCase();
  return Object.keys(users).find((id) => users[id].toLowerCase() === lower);
}
