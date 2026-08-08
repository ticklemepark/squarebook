import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  type TextChannel,
} from "discord.js";
import { CHANNEL_ID, DISCORD_APP_ID, DISCORD_TOKEN, GUILD_ID } from "./config";
import { handleButton, handleChat, handleCommand, type Button, type Reply } from "./engine";
import { startWatcher } from "./notify";

if (!DISCORD_TOKEN || !DISCORD_APP_ID || !GUILD_ID || !CHANNEL_ID) {
  console.error("Set DISCORD_TOKEN, DISCORD_APP_ID, GUILD_ID, and CHANNEL_ID (see .env.example).");
  process.exit(1);
}

const STYLE: Record<NonNullable<Button["style"]>, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

function components(buttons?: Button[]) {
  if (!buttons?.length) return [];
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < Math.min(buttons.length, 25); i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        buttons.slice(i, i + 5).map((b) =>
          new ButtonBuilder()
            .setCustomId(b.id)
            .setLabel(b.label.slice(0, 80))
            .setStyle(STYLE[b.style ?? "secondary"]),
        ),
      ),
    );
  }
  return rows.slice(0, 5);
}

// ephemerality is handled at deferReply time for interactions; plain sends
// (channel feed, DMs) never carry flags
function payload(reply: Reply) {
  return {
    content: reply.content.slice(0, 2000),
    components: components(reply.buttons),
  };
}

const commands = [
  new SlashCommandBuilder()
    .setName("bet")
    .setDescription("Propose a bet")
    .addUserOption((o) => o.setName("user").setDescription("Who you're betting against").setRequired(true))
    .addIntegerOption((o) => o.setName("qty").setDescription("How many").setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName("unit").setDescription("coffee, dessert, dinner, USD, …").setRequired(true))
    .addStringOption((o) => o.setName("terms").setDescription("What the bet is").setRequired(true))
    .addIntegerOption((o) => o.setName("days").setDescription("Days to accept (default 7)")),
  new SlashCommandBuilder().setName("pending").setDescription("Everything awaiting someone's move"),
  new SlashCommandBuilder().setName("balance").setDescription("Who owes what"),
  new SlashCommandBuilder()
    .setName("resolve")
    .setDescription("Claim the result of an active bet")
    .addIntegerOption((o) => o.setName("id").setDescription("Bet id").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("outcome")
        .setDescription("Who won?")
        .setRequired(true)
        .addChoices(
          { name: "I won", value: "i-won" },
          { name: "They won", value: "they-won" },
          { name: "Push / void", value: "push" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("paid")
    .setDescription("Mark a debt you're owed as paid")
    .addIntegerOption((o) => o.setName("id").setDescription("Bet id").setRequired(true)),
  new SlashCommandBuilder()
    .setName("double")
    .setDescription("Offer double or nothing on a bet you won")
    .addIntegerOption((o) => o.setName("id").setDescription("Bet id").setRequired(true))
    .addStringOption((o) => o.setName("terms").setDescription("Rematch terms").setRequired(true)),
  new SlashCommandBuilder()
    .setName("addmember")
    .setDescription("Add a friend to the ledger")
    .addUserOption((o) => o.setName("user").setDescription("Who to add").setRequired(true))
    .addStringOption((o) => o.setName("name").setDescription("Their name on the ledger").setRequired(true)),
  new SlashCommandBuilder().setName("whoami").setDescription("Your ledger identity"),
  new SlashCommandBuilder().setName("ledger").setDescription("Where the ledger lives and how to verify it"),
].map((c) => c.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async () => {
  const rest = new REST().setToken(DISCORD_TOKEN!);
  await rest.put(Routes.applicationGuildCommands(DISCORD_APP_ID!, GUILD_ID!), { body: commands });
  console.log(`Squarebook bot ready as ${client.user?.tag}`);

  const channel = (await client.channels.fetch(CHANNEL_ID!)) as TextChannel;
  startWatcher(async (o) => {
    if (o.kind === "channel") {
      await channel.send(payload(o.reply));
    } else if (o.discordId) {
      const user = await client.users.fetch(o.discordId);
      await user.send(payload(o.reply)).catch(() => {
        // DMs closed — the channel feed still carries the news
      });
    }
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const opts: Record<string, string | number | undefined> = {};
      for (const o of interaction.options.data) opts[o.name] = o.value as string | number;
      const reply = await handleCommand(interaction.user.id, interaction.commandName, opts);
      await interaction.editReply({ content: reply.content, components: components(reply.buttons) });
    } else if (interaction.isButton()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reply = await handleButton(interaction.user.id, interaction.customId);
      await interaction.editReply({ content: reply.content, components: components(reply.buttons) });
    }
  } catch (e) {
    console.error("interaction error:", e);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.guildId) return; // DMs only for the chat flow
  try {
    const replies = await handleChat(message.author.id, message.content);
    for (const r of replies) await message.channel.send(payload(r));
  } catch (e) {
    console.error("chat error:", e);
  }
});

client.login(DISCORD_TOKEN);
