import {
  Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder,
  ChatInputCommandInteraction, EmbedBuilder, ActivityType, Events,
  PermissionFlagsBits, AuditLogEvent, Guild, GuildMember, Message,
  TextChannel, ChannelType, User, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ButtonInteraction,
} from "discord.js";
import { logger } from "./lib/logger";
import fs from "node:fs";
import path from "node:path";

// ─── Client Initialization ─────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ─── Config ───────────────────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const DATA_FILE = path.resolve("./bot-data.json");
const INSTAPAY_NUMBER = "+201552844442";
const OWNER_CONTACT = "7d35";
const PRICE_EGP = 100;
const PRICE_USD = 2;
const BOT_START_TIME = Date.now();
let BOT_OWNER_ID = "";

// ─── Database ─────────────────────────────────────────────────────────────────
interface BotData {
  subscriptions: Record<string, { since: string; grantedBy: string; expiresAt: string }>;
  ownerIds: Record<string, string>;
  shieldedChannels: Record<string, string[]>;
  blacklist: string[];
  antilinkGuilds: string[];
  warnings: Record<string, Record<string, number>>;
  pendingSubscriptions: Record<string, any>;
  afkUsers: Record<string, any>;
  logChannels: Record<string, string>;
  welcomeMessages: Record<string, string>;
  wordFilters: Record<string, string[]>;
}

function loadData(): BotData {
  const defaults: BotData = { subscriptions: {}, ownerIds: {}, shieldedChannels: {}, blacklist: [], antilinkGuilds: [], warnings: {}, pendingSubscriptions: {}, afkUsers: {}, logChannels: {}, welcomeMessages: {}, wordFilters: {} };
  try { if (fs.existsSync(DATA_FILE)) return { ...defaults, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) }; } catch {}
  return defaults;
}
function saveData(d: BotData) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
const db = loadData();

// ─── Commands List ─────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("🏓 Check bot latency"),
  new SlashCommandBuilder().setName("features").setDescription("✨ See bot features"),
  new SlashCommandBuilder().setName("help").setDescription("📖 Full command list")
].map(c => c.toJSON());

// ─── Handlers ────────────────────────────────────────────────────────────────
async function handlePing(i: ChatInputCommandInteraction) {
  await i.reply({ content: `🏓 Pong! Latency: ${client.ws.ping}ms`, ephemeral: true });
}

async function handleFeatures(i: ChatInputCommandInteraction) {
  await i.reply({ content: "✨ SaftyBot is active and protecting your server!", ephemeral: true });
}

// ─── Startup Logic ────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  BOT_OWNER_ID = c.user.id;
  console.log(`✅ SaftyBot is online! Logged in as ${c.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN!);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
  } catch (e) { console.error(e); }
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;
  const handlerName = `handle${i.commandName.charAt(0).toUpperCase() + i.commandName.slice(1)}`;
  const handler = (global as any)[handlerName] || (i.commandName === 'ping' ? handlePing : (i.commandName === 'features' ? handleFeatures : null));
  
  if (handler) {
    try { await handler(i); } catch (e) { console.error(e); }
  }
});

client.login(DISCORD_TOKEN);

