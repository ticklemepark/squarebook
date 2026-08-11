import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Spectrum, type Content, type Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { commandHint, handleText } from "./textcmd";
import { startWatcher } from "./notify";
import { recordUser } from "./users";
import type { Reply } from "./engine";

/**
 * iMessage adapter via Photon's Spectrum SDK. The engine is shared with the
 * Discord adapter; the differences live here:
 * - users are identified by phone number / email handle
 * - buttons render as reply-command hints (`↩️ Reply: accept 5 · decline 5`)
 * - the "feed channel" is a group chat: add the agent's number to your
 *   friend-group iMessage thread and the first group it hears becomes home
 *   (or pin one with HOME_SPACE_ID)
 */

const PROJECT_ID = process.env.PROJECT_ID;
const PROJECT_SECRET = process.env.PROJECT_SECRET;
if (!PROJECT_ID || !PROJECT_SECRET) {
  console.error("Set PROJECT_ID and PROJECT_SECRET from app.photon.codes (see .env.example).");
  process.exit(1);
}

// ------------------------------------------------------- home-group persistence

const SPACES_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "spaces.json");

function loadHome(): string | undefined {
  if (process.env.HOME_SPACE_ID) return process.env.HOME_SPACE_ID;
  if (!existsSync(SPACES_FILE)) return undefined;
  return (JSON.parse(readFileSync(SPACES_FILE, "utf8")) as { home?: string }).home;
}

function saveHome(id: string | undefined) {
  mkdirSync(dirname(SPACES_FILE), { recursive: true });
  writeFileSync(SPACES_FILE, JSON.stringify({ home: id }, null, 2));
}

let homeSpaceId = loadHome();

// shared-mode numbers can't create groups (space.create is dedicated-number
// only) — but they can adopt an existing thread via space.get, so the flow
// is: the user makes the group chat and the agent claims it on first message

const GROUP_HOWTO =
  "Shared-number agents can't create group chats. Do it from your side: in Messages, start a group with me and your friends, then send any message in it — I'll adopt that thread as the Squarebook feed.";

const COMMAND_SHAPE =
  /^(accept|decline|cancel|agree|dispute|escalate|vote|finalize|paid|double|won|lost|push|bet|addmember|pending|balances?|whoami|ledger|help)\b/i;

// ----------------------------------------------------------------- rendering

function contentToText(content: Content): string | undefined {
  if (content.type === "text") return content.text;
  if (content.type === "markdown") return content.markdown;
  if (content.type === "reply" && content.content.type === "text") return content.content.text;
  return undefined;
}

/** iMessage renders plain text — drop the markdown bold markers the engine uses. */
function renderReply(reply: Reply): string {
  return (reply.content + commandHint(reply.buttons)).replaceAll("**", "");
}

// --------------------------------------------------------------------- main

const app = await Spectrum({
  projectId: PROJECT_ID,
  projectSecret: PROJECT_SECRET,
  providers: [imessage.config()],
});
const im = imessage(app);
console.log("Squarebook agent connected to Photon (iMessage).");

async function dm(userId: string, text: string) {
  const space = await im.space.create(userId);
  await space.send(text);
}

startWatcher(async (o) => {
  const text = renderReply(o.reply);
  try {
    if (o.kind === "channel") {
      if (homeSpaceId) {
        // a group feed exists (Business tier / pinned space)
        const space = await im.space.get(homeSpaceId);
        await space.send(text);
      } else {
        // Photon free tier limits iMessage group messaging, so the "feed"
        // is a broadcast: every member gets the event as a DM (minus anyone
        // the event already DM'd directly)
        for (const userId of o.fanout ?? []) {
          await dm(userId, text).catch((e) => console.error(`fanout to ${userId} failed:`, e));
        }
      }
    } else if (o.discordId) {
      await dm(o.discordId, text);
    }
  } catch (e) {
    console.error("notify send failed:", e);
  }
});

for await (const [space, message] of app.messages) {
  try {
    if (message.direction !== "inbound") continue;
    const sender = message.sender;
    if (sender?.kind === "agent") continue;
    const text = contentToText(message.content);

    const sp = imessage.is(space as Space) ? imessage(space as Space) : undefined;
    const isGroup = sp?.type === "group";
    console.log(
      `[inbound] ${isGroup ? "group" : "dm"} space=${space.id} sender=${sender?.id ?? "<unattributed>"} type=${message.content.type}${text ? ` text=${JSON.stringify(text.slice(0, 80))}` : ""}`,
    );

    // adopt the first group thread we hear as the feed — BEFORE any sender
    // filtering, since shared-mode group messages may arrive unattributed
    if (isGroup && !homeSpaceId) {
      homeSpaceId = space.id;
      saveHome(space.id);
      await space.send(
        "🎲 This thread is now the Squarebook feed — every bet, vote, and settlement lands here. Text me `help` for commands, or DM me to make a bet in plain English.",
      );
    }

    if (!text) continue;

    if (!sender) {
      // can't sign on behalf of an unknown sender; commands need attribution
      if (isGroup && COMMAND_SHAPE.test(text.trim()))
        await space.send("I can't tell who sent that in this thread — DM me the command instead. The feed still posts here.");
      continue;
    }

    recordUser(sender.id);

    // group-feed management (DM-only commands)
    const lower = text.trim().toLowerCase();
    if (!isGroup && (lower === "group" || lower === "creategroup")) {
      await space.send(homeSpaceId ? `The feed already has a home thread. Text \`nogroup\` to detach it.\n${GROUP_HOWTO}` : GROUP_HOWTO);
      continue;
    }
    if (!isGroup && lower === "nogroup") {
      homeSpaceId = undefined;
      saveHome(undefined);
      await space.send("Group feed off — everyone gets the feed as DMs again.");
      continue;
    }

    const replies = await handleText(sender.id, text, isGroup ? "group" : "dm");
    for (const r of replies) await space.send(renderReply(r));
  } catch (e) {
    console.error("message handling error:", e);
  }
}
