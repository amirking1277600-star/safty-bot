import { Client, GatewayIntentBits, Events } from "discord.js";

// ─── Setup ───────────────────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

// ─── Startup Log ─────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(✅ [SUCCESS] Logged in as ${c.user.tag});
  console.log(🚀 [STATUS] Bot is now Online!);
});

// ─── Error Handling ──────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[ERROR] Uncaught Exception:', err);
});

// ─── Start ───────────────────────────────────────────────────────────────────
if (!DISCORD_TOKEN) {
  console.error("[CRITICAL] DISCORD_TOKEN is missing!");
} else {
  client.login(DISCORD_TOKEN).catch(err => {
    console.error("[CRITICAL] Login failed:", err);
  });
}
