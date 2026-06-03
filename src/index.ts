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
  AuditLogEvent,
  Guild,
  GuildMember,
  Message,
  TextChannel,
  ChannelType,
  User,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ButtonInteraction,
} from "discord.js";
import { logger } from "./lib/logger";
import fs from "node:fs";
import path from "node:path";

// ─── Config ───────────────────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const DATA_FILE = path.resolve("./bot-data.json");
const INSTAPAY_NUMBER = "+201552844442";
const OWNER_CONTACT = "7d35";
const PRICE_EGP = 100;
const PRICE_USD = 2;
const FAKE_ACCOUNT_DAYS = 7;
const SUB_DURATION_DAYS = 30;
const BOT_START_TIME = Date.now();
let BOT_OWNER_ID = "";

// ─── Persistent Storage ───────────────────────────────────────────────────────
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

const hasSubscription = (gid: string) => {
  const sub = db.subscriptions[gid];
  if (!sub) return false;
  if (sub.expiresAt && new Date(sub.expiresAt) < new Date()) return false;
  return true;
};

// باقي الكود موجود في الرسالة السابقة، كمل نسخه بنفس الطريقة بالظبط.