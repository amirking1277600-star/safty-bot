import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActivityType,
  Events,
  PermissionFlagsBits,
  TextChannel,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ButtonInteraction,
} from "discord.js";
import { logger } from "./lib/logger";
import fs from "node:fs";
import path from "node:path";

const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const DATA_FILE = path.resolve("./bot-data.json");
const INSTAPAY_NUMBER = "+201552844442";
const OWNER_CONTACT = "7d35";
const PRICE_EGP = 100;
const SUB_DURATION_DAYS = 30;
const BOT_START_TIME = Date.now();
let BOT_OWNER_ID = process.env["BOT_OWNER_ID"] || "";

interface BotData {
  subscriptions: Record<string, { since: string; grantedBy: string; expiresAt: string }>;
  ownerIds: Record<string, string>;
  shieldedChannels: Record<string, string[]>;
  blacklist: string[];
  antilinkGuilds: string[];
  warnings: Record<string, Record<string, number>>;
  pendingSubscriptions: Record<string, { guildId: string; userId: string; guildName: string; userName: string; userTag: string; requestedAt: string }>;
  afkUsers: Record<string, { reason: string; since: string }>;
  logChannels: Record<string, string>;
  welcomeMessages: Record<string, string>;
  wordFilters: Record<string, string[]>;
}

function loadData(): BotData {
  const defaults: BotData = {
    subscriptions: {}, ownerIds: {}, shieldedChannels: {}, blacklist: [],
    antilinkGuilds: [], warnings: {}, pendingSubscriptions: {}, afkUsers: {},
    logChannels: {}, welcomeMessages: {}, wordFilters: {},
  };
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      return { ...defaults, ...saved };
    }
  } catch {}
  return defaults;
}

function saveData(d: BotData) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
const db = loadData();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ [SUCCESS] Logged in as ${c.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN!);
  rest.put(Routes.applicationCommands(c.user.id), { body: [] }).catch(console.error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    // Command routing logic would go here
  } else if (interaction.isButton()) {
    await handleSubscriptionButton(interaction as ButtonInteraction, client);
  }
});

async function handleSubscriptionButton(interaction: ButtonInteraction, client: Client) {
  const parts = interaction.customId.split("_");
  const action = parts[0];
  const guildId = parts[2];
  const userId = parts[3];
  const key = `${guildId}_${userId}`;
  const pending = db.pendingSubscriptions[key];

  if (!pending) { await interaction.update({ content: "⚠️ Request expired.", components: [] }); return; }

  if (action === "accept") {
    const expiresAt = new Date(Date.now() + SUB_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.subscriptions[guildId] = { since: new Date().toISOString(), grantedBy: BOT_OWNER_ID, expiresAt };
    delete db.pendingSubscriptions[key];
    saveData(db);
    await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Approved").setDescription(`Subscription for ${pending.guildName} activated.`)], components: [] });
  } else {
    delete db.pendingSubscriptions[key];
    saveData(db);
    await interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Declined")], components: [] });
  }
}

if (!DISCORD_TOKEN) {
  console.error("[CRITICAL] DISCORD_TOKEN missing!");
} else {
  client.login(DISCORD_TOKEN).catch(console.error);
}
