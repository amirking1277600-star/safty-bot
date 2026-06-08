import pino from "pino";
import {
  Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder,
  ChatInputCommandInteraction, EmbedBuilder, ActivityType, Events,
  PermissionFlagsBits, GuildMember, Message, TextChannel, ButtonBuilder,
  ButtonStyle, ActionRowBuilder, ButtonInteraction,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";

const logger = pino({ level: "info" });
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const DATA_FILE = path.resolve(process.cwd(), "bot-data.json");
const INSTAPAY_NUMBER = "+201552844442";
const OWNER_CONTACT = "7d35";
const PRICE_EGP = 100;
const PRICE_USD = 2;
const SUB_DURATION_DAYS = 30;
const BOT_START_TIME = Date.now();
const BOT_OWNER_ID = "1409336978243063908";

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
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Partial<BotData>;
      return { ...defaults, ...saved };
    }
  } catch { }
  return defaults;
}

function saveData(d: BotData) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

const db = loadData();

async function alertOwner(client: any, guildId: string, title: string, desc: string, danger: boolean) {
  const oid = db.ownerIds[guildId];
  if (!oid) return;
  try {
    const user = await client.users.fetch(oid);
    await (user as any).send({ embeds: [new EmbedBuilder().setColor(danger ? 0xed4245 : 0x57f287).setTitle(danger ? `🚨 ${title}` : `✅ ${title}`).setDescription(desc).setTimestamp()] });
  } catch (e) { logger.error(e); }
}

async function broadcastToSubscribers(client: any, embed: EmbedBuilder) {
  let dmSent = 0, dmFailed = 0, channelSent = 0;
  for (const gid of Object.keys(db.subscriptions)) {
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;
    const oid = db.ownerIds[gid];
    if (oid) {
      try {
        const user = await client.users.fetch(oid);
        await (user as any).send({ embeds: [embed] });
        dmSent++;
      } catch { dmFailed++; }
    }
    try { const sys = guild.systemChannel; if (sys) { await (sys as any).send({ embeds: [embed] }); channelSent++; } } catch { }
  }
  return { dmSent, dmFailed, channelSent };
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Message, Partials.Channel]
});

client.once(Events.ClientReady, c => {
  logger.info(`Ready! Logged in as ${c.user.tag}`);
});

client.login(DISCORD_TOKEN);
