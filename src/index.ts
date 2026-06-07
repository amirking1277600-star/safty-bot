import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ButtonInteraction,
} from "discord.js";

// Import local modules with .js extension for TS/Node compatibility
import { logger } from "./lib/logger.js";
// Assuming you moved the main logic to a file named 'bot.ts'
import { client, handleSubscriptionButton } from "./bot.js"; 

const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];

// ─── Event Handling ──────────────────────────────────────────────────────────
client.on(Events.ClientReady, (c) => {
  logger.info(`✅ [SUCCESS] Logged in as ${c.user.tag}`);
  console.log(`🚀 [STATUS] Bot is now Online!`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    try {
      await handleSubscriptionButton(interaction as ButtonInteraction, client);
    } catch (err) {
      logger.error({ err }, "Error handling button interaction");
    }
  }
});

// ─── Error Handling ──────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception');
});

// ─── Start ───────────────────────────────────────────────────────────────────
if (!DISCORD_TOKEN) {
  logger.error("[CRITICAL] DISCORD_TOKEN is missing!");
} else {
  client.login(DISCORD_TOKEN.trim()).catch(err => {
    logger.error("[CRITICAL] Login failed:", err);
  });
}
