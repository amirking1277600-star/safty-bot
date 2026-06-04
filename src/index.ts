import {
  Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder,
  ChatInputCommandInteraction, EmbedBuilder, Events, PermissionFlagsBits,
  TextChannel, ButtonBuilder, ButtonStyle, ActionRowBuilder, ButtonInteraction,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";

// ─── Config & Client ──────────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const DATA_FILE = path.resolve("./bot-data.json");
const INSTAPAY_NUMBER = "+201552844442";
const OWNER_CONTACT = "7d35";
const PRICE_EGP = 100;
const PRICE_USD = 2;
const BOT_START_TIME = Date.now();
let BOT_OWNER_ID = "";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ─── Database Functions ──────────────────────────────────────────────────────
const db = loadData();
function loadData() {
  const defaults = { subscriptions: {}, ownerIds: {}, shieldedChannels: {}, blacklist: [], antilinkGuilds: [], warnings: {}, pendingSubscriptions: {}, afkUsers: {}, logChannels: {}, welcomeMessages: {}, wordFilters: {} };
  try { if (fs.existsSync(DATA_FILE)) return { ...defaults, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) }; } catch {}
  return defaults;
}
function saveData(d: any) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
const hasSubscription = (gid: string) => !!db.subscriptions[gid];

// ─── Commands & Handlers ──────────────────────────────────────────────────────
// ملاحظة: الأوامر الخاصة بك تم تعريفها في مصفوفة commands
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("🏓 Check bot latency"),
  new SlashCommandBuilder().setName("features").setDescription("✨ See bot features"),
  new SlashCommandBuilder().setName("help").setDescription("📖 Full command list")
  // يمكنك إضافة باقي الـ Builders هنا كما في كودك الأصلي
].map(c => c.toJSON());

async function handlePing(i: ChatInputCommandInteraction) {
  const lat = Date.now() - i.createdTimestamp;
  await i.reply({ content: `🏓 Pong! Latency: ${lat}ms`, ephemeral: true });
}

async function handleFeatures(i: ChatInputCommandInteraction) {
  await i.reply({ content: "🛡️ SaftyBot is active! Use /help for commands.", ephemeral: true });
}

// ─── Startup ──────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  BOT_OWNER_ID = c.user.id;
  console.log(`✅ ${c.user.tag} is online!`);
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN!);
  await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
});

client.on(Events.InteractionCreate, async (i) => {
  if (i.isChatInputCommand()) {
    if (i.commandName === 'ping') await handlePing(i);
    if (i.commandName === 'features') await handleFeatures(i);
    // أضف باقي الربط هنا
  }
});

client.login(DISCORD_TOKEN);
