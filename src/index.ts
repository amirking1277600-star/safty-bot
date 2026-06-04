import {
  Client, GatewayIntentBits, Partials, Events,
} from "discord.js";

// ─── Setup ───────────────────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ─── Logging for Railway ─────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`✅ [SUCCESS] Logged in as ${c.user.tag}`);
  console.log(`🚀 [STATUS] Bot is now Online!`);
});

// ─── Basic Command Listener ──────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply({ content: '🏓 Pong! The bot is fully operational.', ephemeral: true });
  }
});

// ─── Error Handling ──────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[ERROR] Uncaught Exception:', err);
});

// ─── Start Bot ───────────────────────────────────────────────────────────────
if (!DISCORD_TOKEN) {
  console.error("[CRITICAL] DISCORD_TOKEN is missing in environment variables!");
} else {
  client.login(DISCORD_TOKEN).catch(err => {
    console.error("[CRITICAL] Failed to login:", err);
  });
}
