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
const isShielded = (gid: string, chId: string) => db.shieldedChannels[gid]?.includes(chId) ?? false;
const isBlacklisted = (uid: string) => db.blacklist.includes(uid);
const isAntilinkEnabled = (gid: string) => db.antilinkGuilds.includes(gid);

function addWarning(gid: string, uid: string): number {
  if (!db.warnings[gid]) db.warnings[gid] = {};
  db.warnings[gid][uid] = (db.warnings[gid][uid] ?? 0) + 1;
  saveData(db);
  return db.warnings[gid][uid];
}

// ─── In-Memory Tracking ───────────────────────────────────────────────────────
const messageLog = new Map<string, number[]>();
const mutedUsers = new Set<string>();
const nukeLog = new Map<string, { actions: number[]; warned: boolean }>();
const joinLog = new Map<string, number[]>();
const sniped = new Map<string, { content: string; author: string; avatar: string; at: Date }>();
const editSniped = new Map<string, { before: string; after: string; author: string; at: Date }>();
const renewalNotified = new Set<string>();

const SPAM_LIMIT = 6, SPAM_WINDOW_MS = 5000;
const NUKE_THRESHOLD = 3, NUKE_WINDOW_MS = 10000;
const RAID_THRESHOLD = 8, RAID_WINDOW_MS = 10000;
const MENTION_LIMIT = 5;

function trackSpam(uid: string) { const now = Date.now(); const ts = (messageLog.get(uid) ?? []).filter(t => now - t < SPAM_WINDOW_MS); ts.push(now); messageLog.set(uid, ts); return ts.length >= SPAM_LIMIT; }
function trackNuke(uid: string) { const now = Date.now(); const e = nukeLog.get(uid) ?? { actions: [], warned: false }; const r = e.actions.filter(t => now - t < NUKE_WINDOW_MS); r.push(now); nukeLog.set(uid, { actions: r, warned: e.warned }); return r.length >= NUKE_THRESHOLD; }
function markWarned(uid: string) { const e = nukeLog.get(uid); if (e) nukeLog.set(uid, { ...e, warned: true }); }
function trackJoin(gid: string) { const now = Date.now(); const ts = (joinLog.get(gid) ?? []).filter(t => now - t < RAID_WINDOW_MS); ts.push(now); joinLog.set(gid, ts); return ts.length >= RAID_THRESHOLD; }

// ─── Commands ─────────────────────────────────────────────────────────────────
const commands = [
  // Public
  new SlashCommandBuilder().setName("ping").setDescription("🏓 Check bot latency and status"),
  new SlashCommandBuilder().setName("help").setDescription("📖 Full command list"),
  new SlashCommandBuilder().setName("features").setDescription("✨ See everything SaftyBot can do"),
  new SlashCommandBuilder().setName("status").setDescription("🛡️ Check this server's protection status"),
  new SlashCommandBuilder().setName("subscribe").setDescription("💳 Subscribe for full server protection"),
  new SlashCommandBuilder().setName("invite").setDescription("📨 Get SaftyBot's invite link"),
  new SlashCommandBuilder().setName("uptime").setDescription("⏱️ Check how long the bot has been running"),
  new SlashCommandBuilder().setName("serverinfo").setDescription("📊 Display server information"),
  new SlashCommandBuilder().setName("userinfo").setDescription("👤 Get detailed info about a user").addUserOption(o => o.setName("user").setDescription("User to look up").setRequired(false)),
  new SlashCommandBuilder().setName("avatar").setDescription("🖼️ Get anyone's full-size avatar").addUserOption(o => o.setName("user").setDescription("User").setRequired(false)),
  new SlashCommandBuilder().setName("color").setDescription("🎨 Preview a hex color").addStringOption(o => o.setName("hex").setDescription("Hex code e.g. FF5733").setRequired(true)),
  new SlashCommandBuilder().setName("8ball").setDescription("🎱 Ask the magic 8-ball").addStringOption(o => o.setName("question").setDescription("Your question").setRequired(true)),
  new SlashCommandBuilder().setName("coinflip").setDescription("🪙 Flip a coin"),
  new SlashCommandBuilder().setName("dice").setDescription("🎲 Roll a dice").addIntegerOption(o => o.setName("sides").setDescription("Sides (default: 6)").setRequired(false)),
  new SlashCommandBuilder().setName("math").setDescription("🧮 Calculate a math expression").addStringOption(o => o.setName("expression").setDescription("e.g. 2 + 2 * 10").setRequired(true)),
  new SlashCommandBuilder().setName("remind").setDescription("⏰ Set a personal reminder").addIntegerOption(o => o.setName("minutes").setDescription("Time in minutes").setRequired(true)).addStringOption(o => o.setName("message").setDescription("What to remind you about").setRequired(true)),
  new SlashCommandBuilder().setName("afk").setDescription("💤 Set your AFK status").addStringOption(o => o.setName("reason").setDescription("AFK reason").setRequired(false)),
  new SlashCommandBuilder().setName("poll").setDescription("📊 Create a poll").addStringOption(o => o.setName("question").setDescription("Poll question").setRequired(true)).addStringOption(o => o.setName("option1").setDescription("First option").setRequired(true)).addStringOption(o => o.setName("option2").setDescription("Second option").setRequired(true)).addStringOption(o => o.setName("option3").setDescription("Third option (optional)").setRequired(false)).addStringOption(o => o.setName("option4").setDescription("Fourth option (optional)").setRequired(false)),
  new SlashCommandBuilder().setName("report").setDescription("🚨 Report a user to server admins").addUserOption(o => o.setName("user").setDescription("User to report").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),
  new SlashCommandBuilder().setName("snipe").setDescription("👻 Show the last deleted message in this channel"),
  new SlashCommandBuilder().setName("editsnipe").setDescription("✏️ Show the last edited message in this channel"),
  new SlashCommandBuilder().setName("serverrank").setDescription("🏆 Check your warning rank in this server"),

  // Setup (admin, subscription)
  new SlashCommandBuilder().setName("setowner").setDescription("🔑 Register yourself for DM alerts").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setlogchannel").setDescription("📋 Set a channel to log all bot actions").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(o => o.setName("channel").setDescription("Log channel").setRequired(true)),
  new SlashCommandBuilder().setName("setwelcome").setDescription("🎉 Set a custom welcome message").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("message").setDescription("Use {user} {server} {membercount} as placeholders").setRequired(true)),
  new SlashCommandBuilder().setName("addword").setDescription("🤬 Add a word to the auto-delete filter").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("word").setDescription("Word to filter").setRequired(true)),
  new SlashCommandBuilder().setName("removeword").setDescription("✅ Remove a word from the filter").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("word").setDescription("Word to remove").setRequired(true)),
  new SlashCommandBuilder().setName("wordlist").setDescription("📋 View the word filter list").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Moderation (subscription)
  new SlashCommandBuilder().setName("warn").setDescription("⚠️ Warn a user").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("warnings").setDescription("📋 Show warnings for a user").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
  new SlashCommandBuilder().setName("clearwarns").setDescription("🗑️ Clear all warnings for a user").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
  new SlashCommandBuilder().setName("mute").setDescription("🔇 Mute a user").setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addIntegerOption(o => o.setName("minutes").setDescription("Duration in minutes (default: 10)").setRequired(false)),
  new SlashCommandBuilder().setName("unmute").setDescription("🔊 Unmute a user").setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
  new SlashCommandBuilder().setName("kick").setDescription("👢 Kick a user").setDefaultMemberPermissions(PermissionFlagsBits.KickMembers).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("ban").setDescription("🔨 Ban a user").setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("tempban").setDescription("⏱️ Temporarily ban a user").setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addIntegerOption(o => o.setName("minutes").setDescription("Duration in minutes").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("unban").setDescription("🔓 Unban a user by ID").setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)),
  new SlashCommandBuilder().setName("purge").setDescription("🗑️ Delete messages in bulk").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addIntegerOption(o => o.setName("amount").setDescription("Number (1–100)").setRequired(true)).addUserOption(o => o.setName("user").setDescription("Filter by user").setRequired(false)),
  new SlashCommandBuilder().setName("slowmode").setDescription("🐢 Set slowmode on a channel").setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addIntegerOption(o => o.setName("seconds").setDescription("Seconds (0 = off)").setRequired(true)).addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(false)),
  new SlashCommandBuilder().setName("roleadd").setDescription("➕ Add a role to a user").setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),
  new SlashCommandBuilder().setName("roleremove").setDescription("➖ Remove a role from a user").setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),
  new SlashCommandBuilder().setName("channellock").setDescription("🔒 Lock a channel").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("channelunlock").setDescription("🔓 Unlock a channel").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("lockdown").setDescription("🔐 Emergency: lock ALL channels").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("unlock").setDescription("🔓 Unlock all channels after lockdown").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("antilink").setDescription("🔗 Toggle auto-deletion of Discord invite links").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("action").setDescription("Enable or disable").setRequired(true).addChoices({ name: "Enable", value: "on" }, { name: "Disable", value: "off" })),
  new SlashCommandBuilder().setName("scan").setDescription("🔍 Scan for suspicious/fake accounts").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("masscheck").setDescription("🔎 Auto-kick all detected fake accounts").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("shield").setDescription("🛡️ Shield a channel from nuke attacks").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("unshield").setDescription("Remove shield from a channel").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("shieldlist").setDescription("📋 List all shielded channels").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Bot Owner
  new SlashCommandBuilder().setName("addsubscription").setDescription("✅ [Owner] Activate subscription for this server").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("removesubscription").setDescription("❌ [Owner] Remove subscription from a server").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("serverid").setDescription("Server ID").setRequired(true)),
  new SlashCommandBuilder().setName("listsubscriptions").setDescription("📋 [Owner] List all active subscriptions").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("botinfo").setDescription("📊 [Owner] Bot stats and uptime").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("serverlist").setDescription("🌐 [Owner] All servers the bot is in").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("globalban").setDescription("🌐🔨 [Owner] Ban a user from ALL subscribed servers").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("blacklist").setDescription("⛔ [Owner] Add user to global blacklist").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)),
  new SlashCommandBuilder().setName("unblacklist").setDescription("✅ [Owner] Remove user from global blacklist").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)),
  new SlashCommandBuilder().setName("blacklistcheck").setDescription("📋 [Owner] View the global blacklist").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("dm").setDescription("💬 [Owner] DM any user through the bot").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)).addStringOption(o => o.setName("message").setDescription("Message").setRequired(true)),
  new SlashCommandBuilder().setName("news").setDescription("📰 [Owner] Broadcast news to all subscribers").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("message").setDescription("News message").setRequired(true)),
  new SlashCommandBuilder().setName("leak").setDescription("⚠️ [Owner] Broadcast a leak/warning to all subscribers").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("message").setDescription("Leak message").setRequired(true)),
  new SlashCommandBuilder().setName("announce").setDescription("📣 [Owner] Custom broadcast to all subscribers").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("message").setDescription("Text").setRequired(true)).addStringOption(o => o.setName("type").setDescription("Type").setRequired(false).addChoices({ name: "📣 General", value: "general" }, { name: "🚨 Urgent", value: "urgent" }, { name: "💡 Feature Update", value: "update" }, { name: "⚠️ Leak / Warning", value: "leak" }, { name: "📰 News", value: "news" })),
].map(c => c.toJSON());

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ${m % 60}m ${s % 60}s`;
}

async function logAction(client: Client, guildId: string, title: string, description: string, color: number) {
  const channelId = db.logChannels[guildId];
  if (!channelId) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = guild.channels.cache.get(channelId) as TextChannel;
  if (!channel) return;
  try {
    await channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp().setFooter({ text: "SaftyBot Action Log" })] });
  } catch {}
}

async function alertOwner(client: Client, guildId: string, title: string, desc: string, danger: boolean) {
  const oid = db.ownerIds[guildId];
  if (!oid) return;
  try { await (await client.users.fetch(oid)).send({ embeds: [new EmbedBuilder().setColor(danger ? 0xed4245 : 0x57f287).setTitle(danger ? `🚨 ${title}` : `✅ ${title}`).setDescription(desc).setTimestamp().setFooter({ text: "SaftyBot Protection" })] }); } catch {}
}

async function broadcastToSubscribers(client: Client, embed: EmbedBuilder) {
  let dmSent = 0, dmFailed = 0, channelSent = 0;
  for (const gid of Object.keys(db.subscriptions)) {
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;
    const oid = db.ownerIds[gid];
    if (oid) { try { await (await client.users.fetch(oid)).send({ embeds: [embed] }); dmSent++; } catch { dmFailed++; } }
    try { const sys = guild.systemChannel; if (sys) { await sys.send({ embeds: [embed] }); channelSent++; } } catch {}
  }
  return { dmSent, dmFailed, channelSent };
}

async function requireSub(i: ChatInputCommandInteraction): Promise<boolean> {
  if (i.user.id === BOT_OWNER_ID) return true;
  if (!i.guildId || !hasSubscription(i.guildId)) {
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🔒 Subscription Required").setDescription("This command requires an active subscription.\nUse `/subscribe` to activate full protection!\n\n💡 Not sure what you get? Try `/features`!")], ephemeral: true });
    return false;
  }
  return true;
}

async function requireBotOwner(i: ChatInputCommandInteraction): Promise<boolean> {
  if (i.user.id !== BOT_OWNER_ID) { await i.reply({ content: "❌ Only the bot owner can use this.", ephemeral: true }); return false; }
  return true;
}

// ─── Subscription Button System ───────────────────────────────────────────────
async function sendSubscriptionRequest(client: Client, guildId: string, userId: string, guildName: string, userTag: string, userName: string) {
  if (!BOT_OWNER_ID) return;
  const key = `${guildId}_${userId}`;
  db.pendingSubscriptions[key] = { guildId, userId, guildName, userName, userTag, requestedAt: new Date().toISOString() };
  saveData(db);
  const acceptBtn = new ButtonBuilder().setCustomId(`accept_sub_${guildId}_${userId}`).setLabel("✅ Accept Subscription").setStyle(ButtonStyle.Success);
  const declineBtn = new ButtonBuilder().setCustomId(`decline_sub_${guildId}_${userId}`).setLabel("❌ Decline").setStyle(ButtonStyle.Danger);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptBtn, declineBtn);
  try {
    const owner = await client.users.fetch(BOT_OWNER_ID);
    await owner.send({
      embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("💰 New Subscription Request!").setDescription("Someone wants to subscribe to SaftyBot!").addFields(
        { name: "👤 User", value: `**${userTag}** (<@${userId}>) \`${userId}\``, inline: true },
        { name: "🌐 Server", value: `**${guildName}** (\`${guildId}\`)`, inline: true },
        { name: "💳 Payment Info", value: `Awaiting **${PRICE_EGP} EGP** via InstaPay to \`${INSTAPAY_NUMBER}\`\n\nCheck your InstaPay app, then click **Accept** or **Decline**.` }
      ).setTimestamp().setFooter({ text: "Tap a button to respond" })],
      components: [row],
    });
  } catch (err) { logger.error({ err }, "Failed to DM bot owner for subscription request"); }
}

async function handleSubscriptionButton(interaction: ButtonInteraction, client: Client) {
  const parts = interaction.customId.split("_");
  const action = parts[0];
  const guildId = parts[2];
  const userId = parts[3];
  const key = `${guildId}_${userId}`;
  const pending = db.pendingSubscriptions[key];

  if (!pending) { await interaction.update({ content: "⚠️ This request is no longer valid.", components: [] }); return; }

  if (action === "accept") {
    const expiresAt = new Date(Date.now() + SUB_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.subscriptions[guildId] = { since: new Date().toISOString(), grantedBy: BOT_OWNER_ID, expiresAt };
    delete db.pendingSubscriptions[key];
    saveData(db);
    await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Subscription Accepted!").setDescription(`**${pending.guildName}** (${pending.userTag}) activated — expires ${new Date(expiresAt).toLocaleDateString()}!`).setTimestamp()], components: [] });
    try { const user = await client.users.fetch(userId); await user.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🎉 Subscription Activated!").setDescription(`Your subscription for **${pending.guildName}** has been **approved**! Full protection is now active. 😊\n\nRun \`/setowner\` to receive direct security alerts.\n\n📅 Expires: **${new Date(expiresAt).toLocaleDateString()}**`).setTimestamp().setFooter({ text: "SaftyBot — Always Watching" })] }); } catch {}
    const guild = client.guilds.cache.get(guildId);
    guild?.systemChannel?.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🎉 SaftyBot Protection ACTIVATED!").setDescription("Full server protection is now active! Run `/status` to see everything protecting you. 💪").setTimestamp()] }).catch(() => {});
  } else {
    delete db.pendingSubscriptions[key];
    saveData(db);
    await interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Subscription Declined").setDescription(`Request from **${pending.userTag}** for **${pending.guildName}** declined.`).setTimestamp()], components: [] });
    try { const user = await client.users.fetch(userId); await user.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Subscription Not Approved").setDescription(`Your request for **${pending.guildName}** was not approved.\n\nIf you've already paid, contact **@${OWNER_CONTACT}** with your payment screenshot and server ID \`${guildId}\`.`).setTimestamp().setFooter({ text: "SaftyBot Support" })] }); } catch {}
  }
}

// ─── Subscription Expiry Checker ──────────────────────────────────────────────
async function checkSubscriptionExpiry(client: Client) {
  const now = new Date();
  for (const [guildId, sub] of Object.entries(db.subscriptions)) {
    if (!sub.expiresAt) continue;
    const expiresAt = new Date(sub.expiresAt);
    const daysLeft = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    // 3-day renewal warning
    if (daysLeft <= 3 && daysLeft > 0 && !renewalNotified.has(guildId)) {
      renewalNotified.add(guildId);
      const ownerId = db.ownerIds[guildId];
      if (ownerId) {
        try {
          const user = await client.users.fetch(ownerId);
          await user.send({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("⚠️ Subscription Expiring Soon!").setDescription(`Your SaftyBot subscription for this server expires in **${Math.ceil(daysLeft)} day(s)** (${expiresAt.toLocaleDateString()})!\n\nTo renew:\n1. Send **${PRICE_EGP} EGP** via InstaPay to \`${INSTAPAY_NUMBER}\`\n2. Send the screenshot to **@${OWNER_CONTACT}**\n\nDon't let your protection lapse! 🛡️`).setTimestamp().setFooter({ text: "SaftyBot — Renewal Notice" })] });
        } catch {}
      }
    }

    // Expired — remove subscription and notify
    if (daysLeft <= 0) {
      const ownerId = db.ownerIds[guildId];
      delete db.subscriptions[guildId];
      renewalNotified.delete(guildId);
      saveData(db);
      if (ownerId) {
        try {
          const user = await client.users.fetch(ownerId);
          await user.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Subscription Expired").setDescription(`Your SaftyBot subscription has **expired**. Your server is no longer protected.\n\nTo reactivate, renew your subscription:\n1. Send **${PRICE_EGP} EGP** via InstaPay to \`${INSTAPAY_NUMBER}\`\n2. Contact **@${OWNER_CONTACT}** with your payment screenshot.`).setTimestamp().setFooter({ text: "SaftyBot — Subscription Expired" })] });
        } catch {}
      }
      const guild = client.guilds.cache.get(guildId);
      guild?.systemChannel?.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("⚠️ SaftyBot Protection Expired").setDescription("This server's subscription has expired. Contact **@7d35** to renew and restore full protection.").setTimestamp()] }).catch(() => {});
    }
  }
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

async function handlePing(i: ChatInputCommandInteraction) {
  const lat = Date.now() - i.createdTimestamp;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🏓 Pong! Alive and watching 24/7!").addFields({ name: "🤖 Bot Latency", value: `${lat}ms`, inline: true }, { name: "📡 API Latency", value: `${Math.round(i.client.ws.ping)}ms`, inline: true }, { name: "⏱️ Uptime", value: formatUptime(Date.now() - BOT_START_TIME), inline: true }).setTimestamp()] });
}

async function handleFeatures(i: ChatInputCommandInteraction) {
  const sub = i.guildId ? hasSubscription(i.guildId) : false;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("✨ SaftyBot — Full Feature List").setDescription(sub ? "✅ Your server has **full protection active!**" : "❌ **Not subscribed** — use `/subscribe`.\nOnly **100 EGP/month** via InstaPay to `+201552844442`").addFields(
    { name: "🛡️ Anti-Spam", value: "Auto-mutes anyone sending 6+ messages in 5 seconds." },
    { name: "💣 Anti-Nuke", value: "Auto-bans users performing 3+ destructive actions in 10s (channel deletes, mass bans, webhooks)." },
    { name: "🚪 Anti-Raid", value: "Detects 8+ joins in 10s and immediately DMs the server owner." },
    { name: "🤖 Fake Account Detection", value: "Auto-kicks accounts <7 days old with no avatar on join." },
    { name: "🔗 Anti-Link", value: "Auto-deletes Discord invite links. Toggle with `/antilink`." },
    { name: "🔇 Anti-Mention Spam", value: `Auto-mutes anyone who mass-mentions ${MENTION_LIMIT}+ users or abuses @everyone/@here.` },
    { name: "🤬 Word Filter", value: "Auto-deletes messages with banned words. Configurable per server with `/addword`." },
    { name: "📋 Action Logs", value: "Every bot action is logged to a dedicated channel in real time. Set with `/setlogchannel`." },
    { name: "🎉 Custom Welcome", value: "Personalized welcome messages for new members. Set with `/setwelcome`." },
    { name: "⏳ Auto-Renewal Reminders", value: "Bot DMs the server owner 3 days before subscription expires." },
    { name: "🛡️ Channel Shields", value: "Shield important channels from deletion attacks." },
    { name: "📩 Owner Alerts", value: "Instant DM alerts for security events." },
    { name: "🔨 Full Moderation Suite", value: "`/ban` `/tempban` `/kick` `/mute` `/unmute` `/unban` `/purge` `/warn` `/slowmode` `/lockdown` `/channellock` `/scan` `/masscheck`" },
    { name: "🎯 Member Tools", value: "`/poll` `/remind` `/afk` `/snipe` `/8ball` `/coinflip` `/dice` `/math` `/avatar`" },
    { name: "💰 Price", value: `**$${PRICE_USD}/month (${PRICE_EGP} EGP)** — InstaPay to \`${INSTAPAY_NUMBER}\`` }
  ).setFooter({ text: "SaftyBot — Smart, Strong, Always Watching 💪" }).setTimestamp()] });
}

async function handleHelp(i: ChatInputCommandInteraction) {
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📖 SaftyBot — Command List").addFields(
    { name: "🌐 Info & Fun", value: "`/ping` `/help` `/features` `/status` `/invite` `/uptime` `/serverinfo` `/userinfo` `/avatar` `/color` `/8ball` `/coinflip` `/dice` `/math`" },
    { name: "⏰ Personal Tools", value: "`/remind` `/afk` `/poll` `/report` `/snipe` `/editsnipe` `/serverrank`" },
    { name: "⚙️ Server Setup", value: "`/setowner` `/setlogchannel` `/setwelcome` `/addword` `/removeword` `/wordlist`" },
    { name: "⚠️ Warnings", value: "`/warn` `/warnings` `/clearwarns`" },
    { name: "🔇 Muting", value: "`/mute` `/unmute`" },
    { name: "🔨 Banning", value: "`/ban` `/tempban` `/unban`" },
    { name: "👢 Other Mod", value: "`/kick` `/purge` `/slowmode` `/roleadd` `/roleremove`" },
    { name: "🔒 Channels", value: "`/channellock` `/channelunlock` `/lockdown` `/unlock` `/antilink`" },
    { name: "🛡️ Protection", value: "`/shield` `/unshield` `/shieldlist` `/scan` `/masscheck`" },
    { name: "📣 Broadcasts", value: "`/news` `/leak` `/announce`" },
    { name: "⚙️ Bot Owner", value: "`/botinfo` `/serverlist` `/globalban` `/blacklist` `/unblacklist` `/blacklistcheck` `/dm` `/addsubscription` `/removesubscription` `/listsubscriptions`" }
  ).setFooter({ text: "Run /features to see what protection you get!" })] });
}

async function handleStatus(i: ChatInputCommandInteraction) {
  const gid = i.guildId!;
  const sub = hasSubscription(gid);
  const subData = db.subscriptions[gid];
  const expiresText = subData?.expiresAt ? new Date(subData.expiresAt).toLocaleDateString() : "N/A";
  await i.reply({ embeds: [new EmbedBuilder().setColor(sub ? 0x57f287 : 0xfee75c).setTitle(`🛡️ Protection Status — ${i.guild!.name}`).addFields(
    { name: "Subscription", value: sub ? `✅ Active (expires ${expiresText})` : "❌ Inactive", inline: true },
    { name: "Owner Alerts", value: db.ownerIds[gid] ? "✅ Set" : "⚠️ Not set", inline: true },
    { name: "Log Channel", value: db.logChannels[gid] ? `✅ <#${db.logChannels[gid]}>` : "❌ Not set", inline: true },
    { name: "Anti-Spam", value: sub ? "✅ Active" : "❌ Locked", inline: true },
    { name: "Anti-Nuke", value: sub ? "✅ Active" : "❌ Locked", inline: true },
    { name: "Anti-Raid", value: sub ? "✅ Active" : "❌ Locked", inline: true },
    { name: "Anti-Link", value: isAntilinkEnabled(gid) ? "✅ Active" : "❌ Off", inline: true },
    { name: "Anti-Mention", value: sub ? "✅ Active" : "❌ Locked", inline: true },
    { name: "Word Filter", value: `${db.wordFilters[gid]?.length ?? 0} words`, inline: true },
    { name: "Shielded Channels", value: `${db.shieldedChannels[gid]?.length ?? 0}`, inline: true },
    { name: "Custom Welcome", value: db.welcomeMessages[gid] ? "✅ Set" : "❌ Default", inline: true },
    { name: "Overall Safety", value: sub ? "🟢 Protected" : "🔴 Vulnerable", inline: true }
  ).setDescription(sub ? "Your server is fully protected! 😊" : "Use `/subscribe` to unlock everything.").setTimestamp()] });
}

async function handleSubscribe(i: ChatInputCommandInteraction, client: Client) {
  if (i.user.id === BOT_OWNER_ID) {
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("👑 You Are the Owner!").setDescription("You are the **bot owner** — all permissions are permanently open to you. You never need a subscription! 😊").setTimestamp().setFooter({ text: "SaftyBot — Owner Access" })], ephemeral: true }); return;
  }
  if (i.guildId && hasSubscription(i.guildId)) {
    const exp = db.subscriptions[i.guildId]?.expiresAt;
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Already Subscribed!").setDescription(`**${i.guild?.name}** is already subscribed! Full protection is active. 😊\n\n📅 Expires: **${exp ? new Date(exp).toLocaleDateString() : "N/A"}**\n\nRun \`/status\` to see all active protections.`).setTimestamp().setFooter({ text: "SaftyBot Premium — Active" })], ephemeral: true }); return;
  }
  await sendSubscriptionRequest(client, i.guildId ?? "DM", i.user.id, i.guild?.name ?? "Unknown", i.user.tag, i.user.username);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("💳 Subscribe to SaftyBot Premium").setDescription("Your request has been sent! The bot owner will review it and **accept or decline shortly**. 😊\n\nTo speed things up, send payment first and DM the owner with your screenshot!\n\n💡 Want to know what you're getting? Use the `/features` command!").addFields(
    { name: "💰 Price", value: `$${PRICE_USD}/month (${PRICE_EGP} EGP)`, inline: true },
    { name: "💳 Payment Method", value: "**InstaPay only**", inline: true },
    { name: "📱 InstaPay Number", value: `\`${INSTAPAY_NUMBER}\``, inline: true },
    { name: "📋 Steps", value: `1. Open your banking app → **InstaPay**\n2. Send **${PRICE_EGP} EGP** to \`${INSTAPAY_NUMBER}\`\n3. Screenshot your confirmation\n4. DM **@${OWNER_CONTACT}** with the screenshot\n5. Wait for approval! 😊` },
    { name: "✅ What You Unlock", value: "Anti-spam • Anti-nuke • Anti-raid • Fake account blocking\nAnti-link • Anti-mention spam • Word filter • Action logs\nCustom welcome messages • Auto-renewal reminders\n24/7 monitoring + full moderation suite" }
  ).setFooter({ text: "Your request has been sent to the bot owner!" })] });
}

async function handleSetLogChannel(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const ch = i.options.getChannel("channel", true);
  db.logChannels[i.guildId!] = ch.id;
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("📋 Log Channel Set!").setDescription(`All bot actions will now be logged to <#${ch.id}>.\n\nEvery mute, ban, kick, fake account block, spam catch, and raid detection will appear there in real time!`).setTimestamp()] });
}

async function handleSetWelcome(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const message = i.options.getString("message", true);
  db.welcomeMessages[i.guildId!] = message;
  saveData(db);
  const preview = message.replace("{user}", `@${i.user.tag}`).replace("{server}", i.guild?.name ?? "Server").replace("{membercount}", `${i.guild?.memberCount ?? 0}`);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🎉 Welcome Message Set!").addFields({ name: "Template", value: `\`${message}\`` }, { name: "Preview", value: preview }).setFooter({ text: "Placeholders: {user} {server} {membercount}" }).setTimestamp()] });
}

async function handleAddWord(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const word = i.options.getString("word", true).toLowerCase();
  if (!db.wordFilters[i.guildId!]) db.wordFilters[i.guildId!] = [];
  if (db.wordFilters[i.guildId!].includes(word)) { await i.reply({ content: `⚠️ \`${word}\` is already in the filter.`, ephemeral: true }); return; }
  db.wordFilters[i.guildId!].push(word);
  saveData(db);
  await i.reply({ content: `✅ \`${word}\` added to the word filter. Messages containing it will be auto-deleted.`, ephemeral: true });
}

async function handleRemoveWord(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const word = i.options.getString("word", true).toLowerCase();
  db.wordFilters[i.guildId!] = (db.wordFilters[i.guildId!] ?? []).filter(w => w !== word);
  saveData(db);
  await i.reply({ content: `✅ \`${word}\` removed from the word filter.`, ephemeral: true });
}

async function handleWordList(i: ChatInputCommandInteraction) {
  const list = db.wordFilters[i.guildId!] ?? [];
  if (!list.length) { await i.reply({ content: "📋 No words in the filter yet. Use `/addword` to add some.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🤬 Word Filter List").setDescription(list.map(w => `• \`${w}\``).join("\n")).setFooter({ text: `${list.length} word(s) filtered` }).setTimestamp()], ephemeral: true });
}

async function handleInvite(i: ChatInputCommandInteraction) {
  const clientId = i.client.user?.id;
  const link = clientId ? `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands` : "Contact **@7d35** to add SaftyBot!";
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("📨 Invite SaftyBot!").setDescription(`[➕ **Click to Invite**](${link})\n\nNeed help? Contact **@${OWNER_CONTACT}**`).setFooter({ text: "SaftyBot — Protecting servers 24/7" }).setTimestamp()] });
}

async function handleUptime(i: ChatInputCommandInteraction) {
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("⏱️ Bot Uptime").setDescription(`Running for **${formatUptime(Date.now() - BOT_START_TIME)}** straight! 💪\n\nI never sleep. Your server is always protected.`).setTimestamp()] });
}

async function handleUserInfo(i: ChatInputCommandInteraction) {
  const target = i.options.getUser("user") ?? i.user;
  const member = i.guild ? await i.guild.members.fetch(target.id).catch(() => null) : null;
  const ageDays = Math.floor((Date.now() - target.createdTimestamp) / (1000 * 60 * 60 * 24));
  const warns = i.guildId ? (db.warnings[i.guildId]?.[target.id] ?? 0) : 0;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`👤 ${target.tag}`).setThumbnail(target.displayAvatarURL()).addFields(
    { name: "User ID", value: target.id, inline: true },
    { name: "Account Age", value: `${ageDays} days`, inline: true },
    { name: "Bot?", value: target.bot ? "Yes" : "No", inline: true },
    { name: "Joined Server", value: member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : "N/A", inline: true },
    { name: "Created", value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true },
    { name: "Warnings", value: `${warns}`, inline: true },
    { name: "Blacklisted?", value: isBlacklisted(target.id) ? "⛔ Yes" : "✅ No", inline: true },
    { name: "AFK?", value: db.afkUsers[target.id] ? `💤 ${db.afkUsers[target.id].reason}` : "❌ No", inline: true },
    { name: "Roles", value: member?.roles.cache.filter(r => r.id !== i.guild?.roles.everyone.id).map(r => r.toString()).join(" ") || "None" }
  ).setTimestamp()] });
}

async function handleAvatar(i: ChatInputCommandInteraction) {
  const target = i.options.getUser("user") ?? i.user;
  const url = target.displayAvatarURL({ size: 4096 });
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🖼️ ${target.tag}'s Avatar`).setImage(url).setDescription(`[Open full size](${url})`).setTimestamp()] });
}

async function handleColor(i: ChatInputCommandInteraction) {
  const hex = i.options.getString("hex", true).replace("#", "");
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) { await i.reply({ content: "❌ Invalid hex. Use format like `FF5733`.", ephemeral: true }); return; }
  const decimal = parseInt(hex, 16);
  const r = (decimal >> 16) & 255, g = (decimal >> 8) & 255, b = decimal & 255;
  await i.reply({ embeds: [new EmbedBuilder().setColor(decimal).setTitle(`🎨 Color #${hex.toUpperCase()}`).addFields({ name: "HEX", value: `#${hex.toUpperCase()}`, inline: true }, { name: "RGB", value: `rgb(${r}, ${g}, ${b})`, inline: true }, { name: "Decimal", value: `${decimal}`, inline: true }).setImage(`https://singlecolorimage.com/get/${hex}/300x100`).setTimestamp()] });
}

const EIGHTBALL = ["✅ It is certain.", "✅ Without a doubt.", "✅ Yes, definitely!", "✅ You may rely on it.", "✅ As I see it, yes.", "✅ Most likely.", "🤔 Reply hazy, try again.", "🤔 Ask again later.", "🤔 Cannot predict now.", "❌ Don't count on it.", "❌ My reply is no.", "❌ Outlook not so good.", "❌ Very doubtful.", "😂 That's a terrible idea!", "💀 The answer is buried deep..."];

async function handle8Ball(i: ChatInputCommandInteraction) {
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎱 Magic 8-Ball").addFields({ name: "❓ Question", value: i.options.getString("question", true) }, { name: "🎱 Answer", value: EIGHTBALL[Math.floor(Math.random() * EIGHTBALL.length)] }).setTimestamp()] });
}

async function handleCoinflip(i: ChatInputCommandInteraction) {
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🪙 Coin Flip!").setDescription(Math.random() < 0.5 ? "🪙 **Heads!**" : "🔵 **Tails!**").setTimestamp()] });
}

async function handleDice(i: ChatInputCommandInteraction) {
  const sides = Math.max(2, Math.min(i.options.getInteger("sides") ?? 6, 100));
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🎲 Dice Roll!").setDescription(`You rolled a **d${sides}** and got: **${Math.floor(Math.random() * sides) + 1}**!`).setTimestamp()] });
}

async function handleMath(i: ChatInputCommandInteraction) {
  const expression = i.options.getString("expression", true);
  if (!/^[\d\s\+\-\*\/\.\(\)\%\^]+$/.test(expression)) { await i.reply({ content: "❌ Only numbers and operators (+, -, *, /, %, ()) allowed.", ephemeral: true }); return; }
  try {
    const result = Function(`"use strict"; return (${expression.replace(/\^/g, "**")})`)();
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🧮 Math Result").addFields({ name: "Expression", value: `\`${expression}\``, inline: true }, { name: "Result", value: `\`${result}\``, inline: true }).setTimestamp()] });
  } catch { await i.reply({ content: "❌ Could not calculate that.", ephemeral: true }); }
}

async function handleRemind(i: ChatInputCommandInteraction) {
  const minutes = Math.min(i.options.getInteger("minutes", true), 1440);
  const msg = i.options.getString("message", true);
  await i.reply({ content: `⏰ Got it! I'll DM you in **${minutes} minute(s)**.`, ephemeral: true });
  setTimeout(async () => { try { await i.user.send({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("⏰ Reminder!").setDescription(msg).setFooter({ text: `Set ${minutes} min ago` }).setTimestamp()] }); } catch {} }, minutes * 60 * 1000);
}

async function handleAfk(i: ChatInputCommandInteraction) {
  const reason = i.options.getString("reason") ?? "AFK";
  db.afkUsers[i.user.id] = { reason, since: new Date().toISOString() };
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x99aab5).setTitle("💤 AFK Status Set").setDescription(`You are now AFK: **${reason}**\n\nSend any message to remove AFK.`).setTimestamp()] });
}

async function handlePoll(i: ChatInputCommandInteraction) {
  const question = i.options.getString("question", true);
  const opts = [i.options.getString("option1", true), i.options.getString("option2", true), i.options.getString("option3"), i.options.getString("option4")].filter(Boolean) as string[];
  const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📊 " + question).setDescription(opts.map((o, idx) => `${emojis[idx]} ${o}`).join("\n\n")).setFooter({ text: `Poll by ${i.user.tag} • React to vote!` }).setTimestamp()] });
  const reply = await i.fetchReply();
  for (let idx = 0; idx < opts.length; idx++) { try { await reply.react(emojis[idx]); } catch {} }
}

async function handleReport(i: ChatInputCommandInteraction) {
  const target = i.options.getUser("user", true);
  const reason = i.options.getString("reason", true);
  await i.reply({ content: `✅ Report submitted for **${target.tag}**.`, ephemeral: true });
  const ownerId = i.guild?.ownerId ?? db.ownerIds[i.guildId!];
  if (ownerId) { try { await (await i.client.users.fetch(ownerId)).send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🚨 Member Report").addFields({ name: "Reported User", value: `${target.tag} (\`${target.id}\`)`, inline: true }, { name: "Reported By", value: `${i.user.tag}`, inline: true }, { name: "Server", value: i.guild?.name ?? "Unknown", inline: true }, { name: "Reason", value: reason }).setTimestamp()] }); } catch {} }
  if (i.guildId) await logAction(i.client, i.guildId, "🚨 Member Report", `**${i.user.tag}** reported **${target.tag}**\nReason: ${reason}`, 0xed4245);
}

async function handleSnipe(i: ChatInputCommandInteraction) {
  const snipe = sniped.get(i.channelId);
  if (!snipe) { await i.reply({ content: "💨 Nothing to snipe here.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("👻 Sniped!").setDescription(snipe.content).setThumbnail(snipe.avatar).setFooter({ text: `Sent by ${snipe.author}` }).setTimestamp(snipe.at)] });
}

async function handleEditSnipe(i: ChatInputCommandInteraction) {
  const snipe = editSniped.get(i.channelId);
  if (!snipe) { await i.reply({ content: "✏️ No recently edited messages here.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("✏️ Edit Sniped!").addFields({ name: "Before", value: snipe.before || "*empty*", inline: true }, { name: "After", value: snipe.after || "*empty*", inline: true }).setFooter({ text: `Edited by ${snipe.author}` }).setTimestamp(snipe.at)] });
}

async function handleServerRank(i: ChatInputCommandInteraction) {
  if (!i.guildId) { await i.reply({ content: "❌ Use in a server.", ephemeral: true }); return; }
  const guildWarns = db.warnings[i.guildId] ?? {};
  const myWarns = guildWarns[i.user.id] ?? 0;
  const sorted = Object.entries(guildWarns).sort(([, a], [, b]) => b - a);
  const rank = sorted.findIndex(([uid]) => uid === i.user.id) + 1;
  const standing = myWarns === 0 ? "🌟 Perfect!" : myWarns < 3 ? "😊 Good standing" : myWarns < 6 ? "⚠️ Watch yourself!" : "🔴 High risk";
  await i.reply({ embeds: [new EmbedBuilder().setColor(myWarns === 0 ? 0x57f287 : myWarns < 3 ? 0xfee75c : 0xed4245).setTitle(`🏆 Server Standing — ${i.user.tag}`).addFields({ name: "Warnings", value: `${myWarns}`, inline: true }, { name: "Rank", value: rank > 0 ? `#${rank} most warned` : "Unranked", inline: true }, { name: "Standing", value: standing }).setTimestamp()] });
}

async function handleServerInfo(i: ChatInputCommandInteraction) {
  const guild = i.guild!;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(`📊 ${guild.name}`).setThumbnail(guild.iconURL()).addFields({ name: "Members", value: `${guild.memberCount}`, inline: true }, { name: "Server ID", value: guild.id, inline: true }, { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }, { name: "Owner", value: `<@${guild.ownerId}>`, inline: true }, { name: "Protection", value: hasSubscription(guild.id) ? "✅ Active" : "❌ Not subscribed", inline: true }, { name: "Log Channel", value: db.logChannels[guild.id] ? `<#${db.logChannels[guild.id]}>` : "Not set", inline: true }).setTimestamp()] });
}

async function handleWarn(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true);
  const reason = i.options.getString("reason") ?? "No reason provided";
  const count = addWarning(i.guildId!, target.id);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("⚠️ Warning Issued").addFields({ name: "User", value: `${target}`, inline: true }, { name: "Total Warnings", value: `${count}`, inline: true }, { name: "Reason", value: reason }).setTimestamp()] });
  try { await target.send(`⚠️ You've been warned in **${i.guild?.name}** (Warning #${count})\nReason: ${reason}`); } catch {}
  await logAction(i.client, i.guildId!, "⚠️ User Warned", `**${target.tag}** warned by **${i.user.tag}** (Warning #${count})\nReason: ${reason}`, 0xfee75c);
}

async function handleWarnings(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true);
  const count = db.warnings[i.guildId!]?.[target.id] ?? 0;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(`⚠️ Warnings — ${target.tag}`).setDescription(`**${count}** warning(s).`).setThumbnail(target.displayAvatarURL()).setTimestamp()] });
}

async function handleClearWarns(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true);
  if (db.warnings[i.guildId!]) { db.warnings[i.guildId!][target.id] = 0; saveData(db); }
  await i.reply({ content: `✅ Cleared all warnings for ${target}.` });
  await logAction(i.client, i.guildId!, "🗑️ Warnings Cleared", `**${target.tag}**'s warnings cleared by **${i.user.tag}**`, 0x99aab5);
}

async function handleMute(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember;
  const minutes = i.options.getInteger("minutes") ?? 10;
  if (!target) { await i.reply({ content: "❌ Member not found.", ephemeral: true }); return; }
  try {
    await target.timeout(minutes * 60 * 1000);
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔇 User Muted").addFields({ name: "User", value: target.user.tag, inline: true }, { name: "Duration", value: `${minutes} min`, inline: true }).setTimestamp()] });
    await logAction(i.client, i.guildId!, "🔇 User Muted", `**${target.user.tag}** muted for **${minutes} min** by **${i.user.tag}**`, 0xed4245);
  } catch { await i.reply({ content: "❌ Could not mute.", ephemeral: true }); }
}

async function handleUnmute(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember;
  if (!target) { await i.reply({ content: "❌ Member not found.", ephemeral: true }); return; }
  try { await target.timeout(null); await i.reply({ content: `✅ ${target.user.tag} unmuted.` }); await logAction(i.client, i.guildId!, "🔊 User Unmuted", `**${target.user.tag}** unmuted by **${i.user.tag}**`, 0x57f287); } catch { await i.reply({ content: "❌ Could not unmute.", ephemeral: true }); }
}

async function handleKick(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember;
  const reason = i.options.getString("reason") ?? "No reason provided";
  if (!target) { await i.reply({ content: "❌ Member not found.", ephemeral: true }); return; }
  try { await target.kick(reason); await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("👢 Kicked").addFields({ name: "User", value: target.user.tag, inline: true }, { name: "Reason", value: reason }).setTimestamp()] }); await logAction(i.client, i.guildId!, "👢 User Kicked", `**${target.user.tag}** kicked by **${i.user.tag}**\nReason: ${reason}`, 0xed4245); } catch { await i.reply({ content: "❌ Could not kick.", ephemeral: true }); }
}

async function handleBan(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true);
  const reason = i.options.getString("reason") ?? "No reason provided";
  try { await i.guild?.members.ban(target, { reason }); await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔨 Banned").addFields({ name: "User", value: target.tag, inline: true }, { name: "Reason", value: reason }).setTimestamp()] }); await logAction(i.client, i.guildId!, "🔨 User Banned", `**${target.tag}** banned by **${i.user.tag}**\nReason: ${reason}`, 0xed4245); } catch { await i.reply({ content: "❌ Could not ban.", ephemeral: true }); }
}

async function handleTempban(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true);
  const minutes = i.options.getInteger("minutes", true);
  const reason = i.options.getString("reason") ?? "Temporary ban";
  try {
    await i.guild?.members.ban(target, { reason });
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("⏱️ Temp-Banned").addFields({ name: "User", value: target.tag, inline: true }, { name: "Duration", value: `${minutes} min`, inline: true }, { name: "Reason", value: reason }).setTimestamp()] });
    await logAction(i.client, i.guildId!, "⏱️ User Temp-Banned", `**${target.tag}** temp-banned for **${minutes} min** by **${i.user.tag}**\nReason: ${reason}`, 0xed4245);
    setTimeout(async () => { try { await i.guild?.members.unban(target, "Temp-ban expired"); await logAction(i.client, i.guildId!, "🔓 Temp-Ban Expired", `**${target.tag}** has been automatically unbanned.`, 0x57f287); } catch {} }, minutes * 60 * 1000);
  } catch { await i.reply({ content: "❌ Could not tempban.", ephemeral: true }); }
}

async function handleUnban(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const uid = i.options.getString("userid", true);
  try { await i.guild?.members.unban(uid); await i.reply({ content: `✅ User \`${uid}\` unbanned.` }); await logAction(i.client, i.guildId!, "🔓 User Unbanned", `\`${uid}\` unbanned by **${i.user.tag}**`, 0x57f287); } catch { await i.reply({ content: "❌ Could not unban.", ephemeral: true }); }
}

async function handlePurge(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const amount = Math.min(Math.max(i.options.getInteger("amount", true), 1), 100);
  const filterUser = i.options.getUser("user");
  const ch = i.channel as TextChannel;
  if (!ch) { await i.reply({ content: "❌ Cannot purge here.", ephemeral: true }); return; }
  try {
    let msgs = await ch.messages.fetch({ limit: 100 });
    if (filterUser) msgs = msgs.filter(m => m.author.id === filterUser.id);
    const toDelete = [...msgs.values()].slice(0, amount);
    const deleted = await ch.bulkDelete(toDelete, true);
    await i.reply({ content: `🗑️ Deleted **${deleted.size}** message(s).`, ephemeral: true });
    await logAction(i.client, i.guildId!, "🗑️ Messages Purged", `**${deleted.size}** messages deleted in <#${ch.id}> by **${i.user.tag}**${filterUser ? ` (filtered: ${filterUser.tag})` : ""}`, 0xfee75c);
  } catch { await i.reply({ content: "❌ Could not delete (messages >14d cannot be bulk-deleted).", ephemeral: true }); }
}

async function handleSlowmode(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const secs = i.options.getInteger("seconds", true);
  const ch = (i.options.getChannel("channel") ?? i.channel) as TextChannel;
  try { await ch.setRateLimitPerUser(secs); await i.reply({ content: secs === 0 ? `✅ Slowmode disabled in <#${ch.id}>.` : `✅ Slowmode set to **${secs}s** in <#${ch.id}>.` }); await logAction(i.client, i.guildId!, "🐢 Slowmode Changed", `Slowmode set to **${secs}s** in <#${ch.id}> by **${i.user.tag}**`, 0x99aab5); } catch { await i.reply({ content: "❌ Could not set slowmode.", ephemeral: true }); }
}

async function handleRoleAdd(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember;
  const role = i.options.getRole("role", true);
  if (!target) { await i.reply({ content: "❌ Member not found.", ephemeral: true }); return; }
  try { await target.roles.add(role.id); await i.reply({ content: `✅ Added ${role} to ${target}.` }); } catch { await i.reply({ content: "❌ Could not add role.", ephemeral: true }); }
}

async function handleRoleRemove(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember;
  const role = i.options.getRole("role", true);
  if (!target) { await i.reply({ content: "❌ Member not found.", ephemeral: true }); return; }
  try { await target.roles.remove(role.id); await i.reply({ content: `✅ Removed ${role} from ${target}.` }); } catch { await i.reply({ content: "❌ Could not remove role.", ephemeral: true }); }
}

async function handleChannelLock(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const ch = i.options.getChannel("channel", true) as TextChannel;
  try { await ch.permissionOverwrites.edit(i.guild!.roles.everyone, { SendMessages: false }); await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔒 Channel Locked").setDescription(`<#${ch.id}> locked.`).setTimestamp()] }); await logAction(i.client, i.guildId!, "🔒 Channel Locked", `<#${ch.id}> locked by **${i.user.tag}**`, 0xed4245); } catch { await i.reply({ content: "❌ Could not lock.", ephemeral: true }); }
}

async function handleChannelUnlock(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const ch = i.options.getChannel("channel", true) as TextChannel;
  try { await ch.permissionOverwrites.edit(i.guild!.roles.everyone, { SendMessages: null }); await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🔓 Channel Unlocked").setDescription(`<#${ch.id}> is open!`).setTimestamp()] }); await logAction(i.client, i.guildId!, "🔓 Channel Unlocked", `<#${ch.id}> unlocked by **${i.user.tag}**`, 0x57f287); } catch { await i.reply({ content: "❌ Could not unlock.", ephemeral: true }); }
}

async function handleLockdown(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  await i.deferReply();
  let locked = 0;
  for (const [, ch] of i.guild!.channels.cache) { if (ch.type === ChannelType.GuildText) { try { await (ch as TextChannel).permissionOverwrites.edit(i.guild!.roles.everyone, { SendMessages: false }); locked++; } catch {} } }
  await i.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔐 LOCKDOWN ACTIVATED").setDescription(`**${locked} channels locked.** Use \`/unlock\` when safe.`).setTimestamp()] });
  await alertOwner(i.client, i.guild!.id, "Lockdown Activated", `${locked} channels locked on **${i.guild!.name}**.`, true);
  await logAction(i.client, i.guildId!, "🔐 Server Lockdown", `**${locked} channels locked** by **${i.user.tag}**`, 0xed4245);
}

async function handleUnlock(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  await i.deferReply();
  let unlocked = 0;
  for (const [, ch] of i.guild!.channels.cache) { if (ch.type === ChannelType.GuildText) { try { await (ch as TextChannel).permissionOverwrites.edit(i.guild!.roles.everyone, { SendMessages: null }); unlocked++; } catch {} } }
  await i.editReply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🔓 Server Unlocked").setDescription(`**${unlocked} channels unlocked!**`).setTimestamp()] });
  await logAction(i.client, i.guildId!, "🔓 Lockdown Lifted", `**${unlocked} channels unlocked** by **${i.user.tag}**`, 0x57f287);
}

async function handleAntilink(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const action = i.options.getString("action", true);
  const gid = i.guildId!;
  if (action === "on") { if (!db.antilinkGuilds.includes(gid)) { db.antilinkGuilds.push(gid); saveData(db); } await i.reply({ content: "✅ **Anti-link enabled!**" }); }
  else { db.antilinkGuilds = db.antilinkGuilds.filter(id => id !== gid); saveData(db); await i.reply({ content: "✅ Anti-link disabled." }); }
}

async function handleScan(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  await i.deferReply();
  const guild = i.guild!;
  await guild.members.fetch();
  const now = Date.now();
  const suspicious: string[] = [];
  let newAcc = 0, noAvatar = 0, bots = 0;
  for (const [, m] of guild.members.cache) {
    if (m.user.bot) { bots++; continue; }
    const days = (now - m.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    const reasons: string[] = [];
    if (days < FAKE_ACCOUNT_DAYS) { reasons.push(`${Math.floor(days)}d old`); newAcc++; }
    if (!m.user.avatar) { reasons.push("no avatar"); noAvatar++; }
    if (/^[a-z]+\d{4,}$/.test(m.user.username)) reasons.push("suspicious name");
    if (reasons.length) suspicious.push(`• **${m.user.tag}** — ${reasons.join(", ")}`);
  }
  const danger = suspicious.length >= 5;
  await i.editReply({ embeds: [new EmbedBuilder().setColor(danger ? 0xed4245 : suspicious.length ? 0xfee75c : 0x57f287).setTitle(`🔍 Scan — ${guild.name}`).addFields({ name: "Members", value: `${guild.memberCount}`, inline: true }, { name: "Bots", value: `${bots}`, inline: true }, { name: "New (<7d)", value: `${newAcc}`, inline: true }, { name: "No Avatar", value: `${noAvatar}`, inline: true }, { name: "Suspicious", value: `${suspicious.length}`, inline: true }, { name: "Threat", value: suspicious.length === 0 ? "🟢 Safe" : danger ? "🔴 Danger" : "🟡 Monitor", inline: true }).setDescription(suspicious.length ? suspicious.slice(0, 15).join("\n") : "✅ All clear!").setTimestamp()] });
  if (danger) await alertOwner(i.client, guild.id, "Scan: Danger!", `Found **${suspicious.length} suspicious accounts** in **${guild.name}**.`, true);
  await logAction(i.client, guild.id, "🔍 Server Scan", `Scan by **${i.user.tag}**: found **${suspicious.length}** suspicious accounts`, danger ? 0xed4245 : 0xfee75c);
}

async function handleMasscheck(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  await i.deferReply();
  const guild = i.guild!;
  await guild.members.fetch();
  let kicked = 0, checked = 0;
  for (const [, m] of guild.members.cache) {
    if (m.user.bot || m.id === guild.ownerId) continue;
    checked++;
    const days = (Date.now() - m.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (days < FAKE_ACCOUNT_DAYS && !m.user.avatar) { try { await m.kick("SaftyBot: Suspected fake account"); kicked++; } catch {} }
  }
  await i.editReply({ embeds: [new EmbedBuilder().setColor(kicked > 0 ? 0xed4245 : 0x57f287).setTitle("🔎 Mass Check Done").addFields({ name: "Checked", value: `${checked}`, inline: true }, { name: "Kicked", value: `${kicked}`, inline: true }).setDescription(kicked > 0 ? `Removed **${kicked} fake accounts**!` : "✅ Clean!").setTimestamp()] });
  await logAction(i.client, guild.id, "🔎 Mass Check", `Masscheck by **${i.user.tag}**: **${kicked}** fake accounts kicked from **${checked}** checked`, kicked > 0 ? 0xed4245 : 0x57f287);
}

async function handleShield(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const ch = i.options.getChannel("channel", true);
  const gid = i.guildId!;
  if (!db.shieldedChannels[gid]) db.shieldedChannels[gid] = [];
  if (db.shieldedChannels[gid].includes(ch.id)) { await i.reply({ content: `🛡️ <#${ch.id}> is already shielded!`, ephemeral: true }); return; }
  db.shieldedChannels[gid].push(ch.id);
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🛡️ Channel Shielded!").setDescription(`<#${ch.id}> is now protected! 💪`).setTimestamp()] });
}

async function handleUnshield(i: ChatInputCommandInteraction) {
  const ch = i.options.getChannel("channel", true);
  db.shieldedChannels[i.guildId!] = (db.shieldedChannels[i.guildId!] ?? []).filter(id => id !== ch.id);
  saveData(db);
  await i.reply({ content: `✅ Shield removed from <#${ch.id}>.`, ephemeral: true });
}

async function handleShieldList(i: ChatInputCommandInteraction) {
  const list = db.shieldedChannels[i.guildId!] ?? [];
  if (!list.length) { await i.reply({ content: "📋 No channels are shielded.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🛡️ Shielded Channels").setDescription(list.map(id => `• <#${id}>`).join("\n")).setTimestamp()], ephemeral: true });
}

async function handleSetOwner(i: ChatInputCommandInteraction) {
  if (i.user.id !== i.guild?.ownerId && i.user.id !== BOT_OWNER_ID) { await i.reply({ content: "❌ Only the server owner can use this.", ephemeral: true }); return; }
  db.ownerIds[i.guildId!] = i.user.id;
  saveData(db);
  await i.reply({ content: `✅ Done! I'll DM you whenever something suspicious happens. Stay safe! 😊`, ephemeral: true });
}

// ─── Bot Owner Handlers ───────────────────────────────────────────────────────

async function handleAddSubscription(i: ChatInputCommandInteraction, client: Client) {
  if (!await requireBotOwner(i)) return;
  const expiresAt = new Date(Date.now() + SUB_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.subscriptions[i.guildId!] = { since: new Date().toISOString(), grantedBy: i.user.id, expiresAt };
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Subscription Activated!").setDescription(`**${i.guild?.name}** now has full protection! 🎉\n\n📅 Expires: **${new Date(expiresAt).toLocaleDateString()}**`).setTimestamp()] });
  await alertOwner(client, i.guildId!, "Subscription Activated!", `Your server **${i.guild?.name}** is fully protected! Expires: **${new Date(expiresAt).toLocaleDateString()}**\n\nRun \`/setowner\` to receive alerts.`, false);
}

async function handleRemoveSubscription(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const id = i.options.getString("serverid", true);
  if (!db.subscriptions[id]) { await i.reply({ content: "❌ No subscription found.", ephemeral: true }); return; }
  const notifyUserId = db.ownerIds[id];
  delete db.subscriptions[id];
  saveData(db);
  await i.reply({ content: `✅ Subscription removed for \`${id}\`.`, ephemeral: true });
  if (notifyUserId) {
    try {
      const user = await i.client.users.fetch(notifyUserId);
      await user.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Subscription Cancelled").setDescription(`Your SaftyBot subscription has been **cancelled**.\n\nYour server no longer has active protection.\n\n📩 For inquiries, contact: **@${OWNER_CONTACT}**`).setTimestamp().setFooter({ text: "SaftyBot — Subscription Notice" })] });
    } catch {}
  }
}

async function handleListSubscriptions(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const entries = Object.entries(db.subscriptions);
  if (!entries.length) { await i.reply({ content: "📋 No active subscriptions.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📋 Active Subscriptions (${entries.length})`).setDescription(entries.map(([gid, info]) => `• \`${gid}\` — expires ${new Date(info.expiresAt).toLocaleDateString()}`).join("\n"))], ephemeral: true });
}

async function handleBotInfo(i: ChatInputCommandInteraction, client: Client) {
  if (!await requireBotOwner(i)) return;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📊 SaftyBot Info").addFields(
    { name: "🟢 Uptime", value: formatUptime(Date.now() - BOT_START_TIME), inline: true },
    { name: "🌐 Servers", value: `${client.guilds.cache.size}`, inline: true },
    { name: "✅ Subscribed", value: `${Object.keys(db.subscriptions).length}`, inline: true },
    { name: "📡 Ping", value: `${Math.round(client.ws.ping)}ms`, inline: true },
    { name: "⛔ Blacklisted", value: `${db.blacklist.length}`, inline: true },
    { name: "⏳ Pending Subs", value: `${Object.keys(db.pendingSubscriptions).length}`, inline: true }
  ).setTimestamp()], ephemeral: true });
}

async function handleServerList(i: ChatInputCommandInteraction, client: Client) {
  if (!await requireBotOwner(i)) return;
  const guilds = [...client.guilds.cache.values()];
  const list = guilds.map(g => `• **${g.name}** (\`${g.id}\`) — ${g.memberCount} members ${hasSubscription(g.id) ? "✅" : "❌"}`).join("\n");
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🌐 Server List (${guilds.length})`).setDescription(list.slice(0, 4096) || "None").setFooter({ text: "✅ = subscribed" })], ephemeral: true });
}

async function handleGlobalBan(i: ChatInputCommandInteraction, client: Client) {
  if (!await requireBotOwner(i)) return;
  const uid = i.options.getString("userid", true);
  const reason = i.options.getString("reason") ?? "Global ban by SaftyBot owner";
  await i.deferReply({ ephemeral: true });
  let banned = 0, failed = 0;
  for (const gid of Object.keys(db.subscriptions)) {
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;
    try { await guild.members.ban(uid, { reason }); banned++; } catch { failed++; }
  }
  await i.editReply(`🌐🔨 **Global Ban Complete!** ✅ Banned from **${banned}** servers ❌ Failed: **${failed}**`);
}

async function handleBlacklist(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const uid = i.options.getString("userid", true);
  if (db.blacklist.includes(uid)) { await i.reply({ content: "⚠️ Already blacklisted.", ephemeral: true }); return; }
  db.blacklist.push(uid); saveData(db);
  await i.reply({ content: `⛔ \`${uid}\` added to global blacklist.`, ephemeral: true });
}

async function handleUnblacklist(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  db.blacklist = db.blacklist.filter(id => id !== i.options.getString("userid", true));
  saveData(db);
  await i.reply({ content: `✅ User removed from blacklist.`, ephemeral: true });
}

async function handleBlacklistCheck(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  if (!db.blacklist.length) { await i.reply({ content: "📋 Blacklist is empty.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("⛔ Global Blacklist").setDescription(db.blacklist.map(id => `• \`${id}\``).join("\n")).setFooter({ text: `${db.blacklist.length} users` })], ephemeral: true });
}

async function handleDm(i: ChatInputCommandInteraction, client: Client) {
  if (!await requireBotOwner(i)) return;
  const uid = i.options.getString("userid", true);
  const msg = i.options.getString("message", true);
  try {
    const user = await client.users.fetch(uid);
    await user.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📬 Message from SaftyBot").setDescription(msg).setFooter({ text: "SaftyBot Official" }).setTimestamp()] });
    await i.reply({ content: `✅ Sent to \`${user.tag}\`.`, ephemeral: true });
  } catch { await i.reply({ content: "❌ Could not DM that user.", ephemeral: true }); }
}

async function handleNews(i: ChatInputCommandInteraction, client: Client) {
  if (!await requireBotOwner(i)) return;
  const msg = i.options.getString("message", true);
  await i.deferReply({ ephemeral: true });
  const embed = new EmbedBuilder().setColor(0x57f287).setTitle("📰 SaftyBot News").setDescription(msg).setTimestamp().setFooter({ text: "SaftyBot — Official News" });
  const { dmSent, dmFailed, channelSent } = await broadcastToSubscribers(client, embed);
  await i.editReply(`📰 **News sent!** DMs: **${dmSent}** Failed: **${dmFailed}** Channels: **${channelSent}**`);
}

async function handleLeak(i: ChatInputCommandInteraction, client: Client) {
  if (!await requireBotOwner(i)) return;
  const msg = i.options.getString("message", true);
  await i.deferReply({ ephemeral: true });
  const embed = new EmbedBuilder().setColor(0xfee75c).setTitle("⚠️ SaftyBot — LEAK / WARNING").setDescription(msg).setTimestamp().setFooter({ text: "SaftyBot — Confidential Alert" });
  const { dmSent, dmFailed, channelSent } = await broadcastToSubscribers(client, embed);
  await i.editReply(`⚠️ **Leak sent!** DMs: **${dmSent}** Failed: **${dmFailed}** Channels: **${channelSent}**`);
}

async function handleAnnounce(i: ChatInputCommandInteraction, client: Client) {
  if (!await requireBotOwner(i)) return;
  const text = i.options.getString("message", true);
  const type = i.options.getString("type") ?? "general";
  const colorMap: Record<string, number> = { general: 0x5865f2, urgent: 0xed4245, update: 0x57f287, leak: 0xfee75c, news: 0x57f287 };
  const labelMap: Record<string, string> = { general: "📣 Announcement", urgent: "🚨 URGENT NOTICE", update: "💡 Feature Update", leak: "⚠️ Leak / Warning", news: "📰 News" };
  const embed = new EmbedBuilder().setColor(colorMap[type] ?? 0x5865f2).setTitle(labelMap[type] ?? "📣 Announcement").setDescription(text).setTimestamp().setFooter({ text: "SaftyBot — Official" });
  await i.deferReply({ ephemeral: true });
  const { dmSent, dmFailed, channelSent } = await broadcastToSubscribers(client, embed);
  await i.editReply(`✅ **Sent!** DMs: **${dmSent}** Failed: **${dmFailed}** Channels: **${channelSent}**`);
}

// ─── Auto-Protection: Messages ────────────────────────────────────────────────
async function handleMessageCreate(client: Client, message: Message) {
  if (!message.guild || message.author.bot) return;

  // Clear AFK on message
  if (db.afkUsers[message.author.id]) {
    delete db.afkUsers[message.author.id];
    saveData(db);
    try { const msg = await message.reply({ content: `👋 Welcome back, ${message.author}! AFK removed.` }); setTimeout(() => msg.delete().catch(() => {}), 5000); } catch {}
  }

  // Notify AFK mentions
  for (const [, user] of message.mentions.users) {
    if (db.afkUsers[user.id]) {
      try { const msg = await message.reply({ content: `💤 **${user.tag}** is AFK: ${db.afkUsers[user.id].reason}` }); setTimeout(() => msg.delete().catch(() => {}), 8000); } catch {}
    }
  }

  if (!hasSubscription(message.guild.id)) return;
  if (!message.member) return;

  // Anti-link
  if (isAntilinkEnabled(message.guild.id) && /(discord\.gg|discord\.com\/invite)\//i.test(message.content)) {
    try {
      await message.delete();
      const msg = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔗 Link Blocked!").setDescription(`${message.author}, invite links are not allowed here!`).setTimestamp()] });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      await logAction(client, message.guild.id, "🔗 Invite Link Deleted", `**${message.author.tag}** posted an invite link in <#${message.channelId}>`, 0xfee75c);
    } catch {}
    return;
  }

  // Word filter
  const words = db.wordFilters[message.guild.id] ?? [];
  const content = message.content.toLowerCase();
  const matched = words.find(w => content.includes(w));
  if (matched) {
    try {
      await message.delete();
      const msg = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🤬 Filtered Word Detected!").setDescription(`${message.author}, your message was removed for containing a banned word.`).setTimestamp()] });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      await logAction(client, message.guild.id, "🤬 Word Filter Triggered", `**${message.author.tag}** used a banned word in <#${message.channelId}>`, 0xfee75c);
    } catch {}
    return;
  }

  // Blacklist kick
  if (isBlacklisted(message.author.id)) {
    try { await message.member.kick("SaftyBot: Globally blacklisted"); await logAction(client, message.guild.id, "⛔ Blacklisted User Kicked", `**${message.author.tag}** was kicked for being globally blacklisted`, 0xed4245); } catch {}
    return;
  }

  // Anti-mention spam
  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  const hasEveryoneHere = message.mentions.everyone;
  const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isAdmin && (mentionCount >= MENTION_LIMIT || hasEveryoneHere)) {
    try {
      await message.delete();
      await message.member.timeout(5 * 60 * 1000, "Mass mention spam");
      await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔇 Mention Spammer Muted!").setDescription(`${message.author} was auto-muted for **5 minutes** for mass-mentioning users.`).setTimestamp()] });
      await alertOwner(client, message.guild.id, "Mention Spam Detected", `**${message.author.tag}** mass-mentioned ${mentionCount} users in **${message.guild.name}**.`, false);
      await logAction(client, message.guild.id, "🔇 Mention Spam Muted", `**${message.author.tag}** auto-muted for mass-mentioning **${mentionCount}** users in <#${message.channelId}>`, 0xed4245);
    } catch {}
    return;
  }

  // Registered owner spam warning
  const registeredOwnerId = db.ownerIds[message.guild.id];
  if (registeredOwnerId && message.author.id === registeredOwnerId) {
    if (!trackSpam(message.author.id)) return;
    try {
      await message.author.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🚨 Unusual Account Activity!").setDescription(`⚠️ **There is unusual activity on your account.**\n\nGuess what, **someone is spamming from your account** in **${message.guild.name}**!\n\nIf this wasn't you:\n• Change your Discord password immediately\n• Enable two-factor authentication (2FA)\n• Log out of unknown devices`).setTimestamp().setFooter({ text: "SaftyBot Security Alert" })] });
    } catch {}
    return;
  }

  // Spam detection
  if (!trackSpam(message.author.id) || mutedUsers.has(message.author.id)) return;
  mutedUsers.add(message.author.id);
  try {
    await message.member.timeout(5 * 60 * 1000, "Spam detected by SaftyBot");
    await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🚫 Spammer Muted!").setDescription(`${message.author} was auto-muted for **5 minutes** for spamming.`).setTimestamp()] });
    await alertOwner(client, message.guild.id, "Spam Handled", `**${message.author.tag}** was auto-muted for spamming in **${message.guild.name}**.`, false);
    await logAction(client, message.guild.id, "🚫 Spam Auto-Muted", `**${message.author.tag}** auto-muted for spamming in <#${message.channelId}>`, 0xed4245);
  } catch {}
  setTimeout(() => mutedUsers.delete(message.author.id), 5 * 60 * 1000);
}

// ─── Auto-Protection: New Members ─────────────────────────────────────────────
async function handleGuildMemberAdd(client: Client, member: GuildMember) {
  if (!hasSubscription(member.guild.id)) return;

  if (isBlacklisted(member.id)) {
    try { await member.kick("SaftyBot: Globally blacklisted"); await logAction(client, member.guild.id, "⛔ Blacklisted User Blocked", `**${member.user.tag}** was kicked on join for being globally blacklisted`, 0xed4245); } catch {}
    return;
  }

  if (trackJoin(member.guild.id)) {
    await alertOwner(client, member.guild.id, "🚨 RAID DETECTED!", `**${RAID_THRESHOLD}+ joins in ${RAID_WINDOW_MS / 1000}s** on **${member.guild.name}**! Use \`/lockdown\` now!`, true);
    await logAction(client, member.guild.id, "🚨 Raid Detected!", `**${RAID_THRESHOLD}+ members** joined in ${RAID_WINDOW_MS / 1000}s — possible raid in progress!`, 0xed4245);
  }

  const ageDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
  if (ageDays < FAKE_ACCOUNT_DAYS && !member.user.avatar) {
    try {
      await member.kick("SaftyBot: Suspected fake account");
      await alertOwner(client, member.guild.id, "Fake Account Blocked", `**${member.user.tag}** (${Math.floor(ageDays)}d old) was auto-kicked.`, false);
      await logAction(client, member.guild.id, "🤖 Fake Account Kicked", `**${member.user.tag}** (account age: ${Math.floor(ageDays)} days, no avatar) was auto-kicked on join`, 0xed4245);
    } catch {}
    return;
  }

  // Custom welcome message
  const welcomeTemplate = db.welcomeMessages[member.guild.id];
  const welcomeText = welcomeTemplate
    ? welcomeTemplate.replace("{user}", member.toString()).replace("{server}", member.guild.name).replace("{membercount}", `${member.guild.memberCount}`)
    : null;

  member.guild.systemChannel?.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("👋 Welcome!").setDescription(welcomeText ?? `Welcome to **${member.guild.name}**, ${member}! 😊`).setThumbnail(member.user.displayAvatarURL()).setTimestamp()] }).catch(() => {});
  await logAction(client, member.guild.id, "👋 New Member", `**${member.user.tag}** joined the server (account age: ${Math.floor(ageDays)} days)`, 0x57f287);
}

// ─── Anti-Nuke Poll ───────────────────────────────────────────────────────────
async function watchAuditLog(client: Client, guild: Guild) {
  if (!hasSubscription(guild.id)) return;
  try {
    const logs = await guild.fetchAuditLogs({ limit: 5 });
    for (const entry of logs.entries.values()) {
      const executor = entry.executor;
      if (!executor || executor.bot) continue;
      const destructive = [AuditLogEvent.ChannelDelete, AuditLogEvent.RoleDelete, AuditLogEvent.MemberBanAdd, AuditLogEvent.WebhookCreate].includes(entry.action);
      if (!destructive) continue;
      if (entry.action === AuditLogEvent.ChannelDelete && isShielded(guild.id, (entry.target as any)?.id)) {
        await alertOwner(client, guild.id, "🚨 Shielded Channel Deleted!", `A shielded channel was deleted by **${executor.tag}** in **${guild.name}**! Use \`/lockdown\` now!`, true);
        await logAction(client, guild.id, "🚨 Shielded Channel Deleted!", `A shielded channel was deleted by **${executor.tag}**`, 0xed4245);
      }
      if (trackNuke(executor.id)) {
        const e = nukeLog.get(executor.id);
        if (e?.warned) continue;
        markWarned(executor.id);
        await alertOwner(client, guild.id, "🚨 NUKE ATTACK!", `**${executor.tag}** performed ${NUKE_THRESHOLD}+ destructive actions in ${NUKE_WINDOW_MS / 1000}s on **${guild.name}**!`, true);
        await logAction(client, guild.id, "💣 Nuke Attempt Detected!", `**${executor.tag}** performed ${NUKE_THRESHOLD}+ destructive actions in ${NUKE_WINDOW_MS / 1000}s — auto-banning!`, 0xed4245);
        try {
          if (executor.id !== guild.ownerId) {
            await guild.members.ban(executor, { reason: "SaftyBot: Auto nuke detection" });
            guild.systemChannel?.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🛡️ NUKE BLOCKED!").setDescription(`**${executor.tag}** was auto-banned for attempting to nuke this server! 💪`).setTimestamp()] }).catch(() => {});
          }
        } catch {}
      }
    }
  } catch {}
}

// ─── Bot Startup ──────────────────────────────────────────────────────────────
export async function startBot() {
  if (!DISCORD_TOKEN) { logger.warn("DISCORD_TOKEN not set — bot will not start"); return; }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
  });

  client.once(Events.ClientReady, async (rc) => {
    logger.info({ tag: rc.user.tag }, "Discord bot is online!");
    try {
      const app = await rc.application.fetch();
      BOT_OWNER_ID = app.owner instanceof User ? app.owner.id : (app.owner as any)?.ownerId ?? "";
      logger.info({ botOwnerId: BOT_OWNER_ID }, "Bot owner identified — full access granted");
    } catch {}
    rc.user.setPresence({ activities: [{ name: "🛡️ Protecting servers 24/7", type: ActivityType.Watching }], status: "online" });
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    try {
      await rest.put(Routes.applicationCommands(rc.user.id), { body: commands });
      logger.info(`Registered ${commands.length} slash commands`);
    } catch (err) { logger.error({ err }, "Failed to register commands"); }

    // Anti-nuke watcher
    setInterval(async () => { for (const [, guild] of rc.guilds.cache) await watchAuditLog(rc, guild); }, 8000);
    // Subscription expiry checker (every hour)
    setInterval(() => checkSubscriptionExpiry(rc), 60 * 60 * 1000);
    // Run once on startup too
    checkSubscriptionExpiry(rc);
  });

  client.on(Events.MessageDelete, msg => {
    if (!msg.author || msg.author.bot || !msg.content) return;
    sniped.set(msg.channelId, { content: msg.content.slice(0, 1024), author: msg.author.tag, avatar: msg.author.displayAvatarURL(), at: new Date() });
  });

  client.on(Events.MessageUpdate, (oldMsg, newMsg) => {
    if (!oldMsg.author || oldMsg.author.bot || !oldMsg.content || !newMsg.content || oldMsg.content === newMsg.content) return;
    editSniped.set(oldMsg.channelId, { before: oldMsg.content.slice(0, 512), after: newMsg.content.slice(0, 512), author: oldMsg.author.tag, at: new Date() });
  });

  client.on(Events.MessageCreate, msg => handleMessageCreate(client, msg));
  client.on(Events.GuildMemberAdd, member => handleGuildMemberAdd(client, member));

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      const btn = interaction as ButtonInteraction;
      if (btn.user.id !== BOT_OWNER_ID) { await btn.reply({ content: "❌ Only the bot owner can use these buttons.", ephemeral: true }); return; }
      if (btn.customId.startsWith("accept_sub_") || btn.customId.startsWith("decline_sub_")) {
        await handleSubscriptionButton(btn, client); return;
      }
    }

    if (!interaction.isChatInputCommand()) return;
    const i = interaction;
    try {
      switch (i.commandName) {
        case "ping": await handlePing(i); break;
        case "help": await handleHelp(i); break;
        case "features": await handleFeatures(i); break;
        case "status": await handleStatus(i); break;
        case "subscribe": await handleSubscribe(i, client); break;
        case "invite": await handleInvite(i); break;
        case "uptime": await handleUptime(i); break;
        case "serverinfo": await handleServerInfo(i); break;
        case "userinfo": await handleUserInfo(i); break;
        case "avatar": await handleAvatar(i); break;
        case "color": await handleColor(i); break;
        case "8ball": await handle8Ball(i); break;
        case "coinflip": await handleCoinflip(i); break;
        case "dice": await handleDice(i); break;
        case "math": await handleMath(i); break;
        case "remind": await handleRemind(i); break;
        case "afk": await handleAfk(i); break;
        case "poll": await handlePoll(i); break;
        case "report": await handleReport(i); break;
        case "snipe": await handleSnipe(i); break;
        case "editsnipe": await handleEditSnipe(i); break;
        case "serverrank": await handleServerRank(i); break;
        case "setowner": await handleSetOwner(i); break;
        case "setlogchannel": await handleSetLogChannel(i); break;
        case "setwelcome": await handleSetWelcome(i); break;
        case "addword": await handleAddWord(i); break;
        case "removeword": await handleRemoveWord(i); break;
        case "wordlist": await handleWordList(i); break;
        case "warn": await handleWarn(i); break;
        case "warnings": await handleWarnings(i); break;
        case "clearwarns": await handleClearWarns(i); break;
        case "mute": await handleMute(i); break;
        case "unmute": await handleUnmute(i); break;
        case "kick": await handleKick(i); break;
        case "ban": await handleBan(i); break;
        case "tempban": await handleTempban(i); break;
        case "unban": await handleUnban(i); break;
        case "purge": await handlePurge(i); break;
        case "slowmode": await handleSlowmode(i); break;
        case "roleadd": await handleRoleAdd(i); break;
        case "roleremove": await handleRoleRemove(i); break;
        case "channellock": await handleChannelLock(i); break;
        case "channelunlock": await handleChannelUnlock(i); break;
        case "lockdown": await handleLockdown(i); break;
        case "unlock": await handleUnlock(i); break;
        case "antilink": await handleAntilink(i); break;
        case "scan": await handleScan(i); break;
        case "masscheck": await handleMasscheck(i); break;
        case "shield": await handleShield(i); break;
        case "unshield": await handleUnshield(i); break;
        case "shieldlist": await handleShieldList(i); break;
        case "addsubscription": await handleAddSubscription(i, client); break;
        case "removesubscription": await handleRemoveSubscription(i); break;
        case "listsubscriptions": await handleListSubscriptions(i); break;
        case "botinfo": await handleBotInfo(i, client); break;
        case "serverlist": await handleServerList(i, client); break;
        case "globalban": await handleGlobalBan(i, client); break;
        case "blacklist": await handleBlacklist(i); break;
        case "unblacklist": await handleUnblacklist(i); break;
        case "blacklistcheck": await handleBlacklistCheck(i); break;
        case "dm": await handleDm(i, client); break;
        case "news": await handleNews(i, client); break;
        case "leak": await handleLeak(i, client); break;
        case "announce": await handleAnnounce(i, client); break;
        default: await i.reply({ content: "Unknown command.", ephemeral: true });
      }
    } catch (err) {
      logger.error({ err, command: i.commandName }, "Command error");
      try { if (!i.replied && !i.deferred) await i.reply({ content: "❌ Something went wrong.", ephemeral: true }); } catch {}
    }
  });

  client.on(Events.Error, err => logger.error({ err }, "Discord error"));
  await client.login(DISCORD_TOKEN);
}

