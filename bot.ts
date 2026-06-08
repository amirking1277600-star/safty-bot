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
  Guild,
  GuildMember,
  Message,
  TextChannel,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ButtonInteraction,
  OverwriteType,
} from "discord.js";
import { logger } from "./lib/logger";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const DATA_FILE = path.resolve(__dirname, "../bot-data.json");
const INSTAPAY_NUMBER = "+201552844442";
const OWNER_CONTACT = "7d35";
const PRICE_EGP = 100;
const PRICE_USD = 2;
const FAKE_ACCOUNT_DAYS = 7;
const SUB_DURATION_DAYS = 30;
const BOT_START_TIME = Date.now();
const BOT_OWNER_ID = process.env["BOT_OWNER_ID"] ?? "";

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
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Partial<BotData>;
      return { ...defaults, ...saved };
    }
  } catch { /* use defaults */ }
  return defaults;
}

function saveData(d: BotData) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

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
const nukeLog = new Map<string, { actions: number[]; warned: boolean }>();
const joinLog = new Map<string, number[]>();
const sniped = new Map<string, { content: string; author: string; avatar: string; at: Date }>();
const editSniped = new Map<string, { before: string; after: string; author: string; at: Date }>();
const renewalNotified = new Set<string>();

const SPAM_LIMIT = 6, SPAM_WINDOW_MS = 5000;
const NUKE_THRESHOLD = 3, NUKE_WINDOW_MS = 10000;
const RAID_THRESHOLD = 8, RAID_WINDOW_MS = 10000;
const MENTION_LIMIT = 5;

function trackSpam(uid: string) {
  const now = Date.now();
  const ts = (messageLog.get(uid) ?? []).filter(t => now - t < SPAM_WINDOW_MS);
  ts.push(now);
  messageLog.set(uid, ts);
  return ts.length >= SPAM_LIMIT;
}

function trackNuke(uid: string) {
  const now = Date.now();
  const e = nukeLog.get(uid) ?? { actions: [], warned: false };
  const r = e.actions.filter(t => now - t < NUKE_WINDOW_MS);
  r.push(now);
  nukeLog.set(uid, { actions: r, warned: e.warned });
  return r.length >= NUKE_THRESHOLD;
}

function markWarned(uid: string) {
  const e = nukeLog.get(uid);
  if (e) nukeLog.set(uid, { ...e, warned: true });
}

function trackJoin(gid: string) {
  const now = Date.now();
  const ts = (joinLog.get(gid) ?? []).filter(t => now - t < RAID_WINDOW_MS);
  ts.push(now);
  joinLog.set(gid, ts);
  return ts.length >= RAID_THRESHOLD;
}

// ─── Commands ─────────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("🏓 Check bot latency and status"),
  new SlashCommandBuilder().setName("help").setDescription("📖 Full command list"),
  new SlashCommandBuilder().setName("features").setDescription("✨ See everything SaftyBot can do"),
  new SlashCommandBuilder().setName("status").setDescription("🛡️ Check this server's protection status"),
  new SlashCommandBuilder().setName("subscribe").setDescription("💳 Subscribe for full server protection"),
  new SlashCommandBuilder().setName("invite").setDescription("📨 Get SaftyBot's invite link"),
  new SlashCommandBuilder().setName("uptime").setDescription("⏱️ Check how long the bot has been running"),
  new SlashCommandBuilder().setName("serverinfo").setDescription("📊 Display server information"),
  new SlashCommandBuilder().setName("userinfo").setDescription("👤 Get detailed info about a user")
    .addUserOption(o => o.setName("user").setDescription("User to look up").setRequired(false)),
  new SlashCommandBuilder().setName("avatar").setDescription("🖼️ Get anyone's full-size avatar")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(false)),
  new SlashCommandBuilder().setName("color").setDescription("🎨 Preview a hex color")
    .addStringOption(o => o.setName("hex").setDescription("Hex code e.g. FF5733").setRequired(true)),
  new SlashCommandBuilder().setName("8ball").setDescription("🎱 Ask the magic 8-ball")
    .addStringOption(o => o.setName("question").setDescription("Your question").setRequired(true)),
  new SlashCommandBuilder().setName("coinflip").setDescription("🪙 Flip a coin"),
  new SlashCommandBuilder().setName("dice").setDescription("🎲 Roll a dice")
    .addIntegerOption(o => o.setName("sides").setDescription("Sides (default: 6)").setRequired(false)),
  new SlashCommandBuilder().setName("math").setDescription("🧮 Calculate a math expression")
    .addStringOption(o => o.setName("expression").setDescription("e.g. 2 + 2 * 10").setRequired(true)),
  new SlashCommandBuilder().setName("remind").setDescription("⏰ Set a personal reminder")
    .addIntegerOption(o => o.setName("minutes").setDescription("Time in minutes").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("What to remind you about").setRequired(true)),
  new SlashCommandBuilder().setName("afk").setDescription("💤 Set your AFK status")
    .addStringOption(o => o.setName("reason").setDescription("AFK reason").setRequired(false)),
  new SlashCommandBuilder().setName("poll").setDescription("📊 Create a poll")
    .addStringOption(o => o.setName("question").setDescription("Poll question").setRequired(true))
    .addStringOption(o => o.setName("option1").setDescription("First option").setRequired(true))
    .addStringOption(o => o.setName("option2").setDescription("Second option").setRequired(true))
    .addStringOption(o => o.setName("option3").setDescription("Third option (optional)").setRequired(false))
    .addStringOption(o => o.setName("option4").setDescription("Fourth option (optional)").setRequired(false)),
  new SlashCommandBuilder().setName("report").setDescription("🚨 Report a user to server admins")
    .addUserOption(o => o.setName("user").setDescription("User to report").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),
  new SlashCommandBuilder().setName("snipe").setDescription("👻 Show the last deleted message in this channel"),
  new SlashCommandBuilder().setName("editsnipe").setDescription("✏️ Show the last edited message in this channel"),
  new SlashCommandBuilder().setName("serverrank").setDescription("🏆 Check your warning rank in this server"),
  // Setup (admin)
  new SlashCommandBuilder().setName("setowner").setDescription("🔑 Register yourself for DM alerts")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setlogchannel").setDescription("📋 Set a channel to log all bot actions")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName("channel").setDescription("Log channel").setRequired(true)),
  new SlashCommandBuilder().setName("setwelcome").setDescription("🎉 Set a custom welcome message")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("message").setDescription("Use {user} {server} {membercount} as placeholders").setRequired(true)),
  new SlashCommandBuilder().setName("addword").setDescription("🤬 Add a word to the auto-delete filter")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("word").setDescription("Word to filter").setRequired(true)),
  new SlashCommandBuilder().setName("removeword").setDescription("✅ Remove a word from the filter")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("word").setDescription("Word to remove").setRequired(true)),
  new SlashCommandBuilder().setName("wordlist").setDescription("📋 View the word filter list")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  // Moderation (subscription required)
  new SlashCommandBuilder().setName("warn").setDescription("⚠️ Warn a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("warnings").setDescription("📋 Show warnings for a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
  new SlashCommandBuilder().setName("clearwarns").setDescription("🗑️ Clear all warnings for a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
  new SlashCommandBuilder().setName("mute").setDescription("🔇 Mute a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Duration in minutes (default: 10)").setRequired(false)),
  new SlashCommandBuilder().setName("unmute").setDescription("🔊 Unmute a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
  new SlashCommandBuilder().setName("kick").setDescription("👢 Kick a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("ban").setDescription("🔨 Ban a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("tempban").setDescription("⏱️ Temporarily ban a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Duration in minutes").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("unban").setDescription("🔓 Unban a user by ID")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)),
  new SlashCommandBuilder().setName("purge").setDescription("🗑️ Delete messages in bulk")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName("amount").setDescription("Number (1–100)").setRequired(true))
    .addUserOption(o => o.setName("user").setDescription("Filter by user").setRequired(false)),
  new SlashCommandBuilder().setName("slowmode").setDescription("🐢 Set slowmode on a channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o => o.setName("seconds").setDescription("Seconds (0 = off)").setRequired(true))
    .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(false)),
  new SlashCommandBuilder().setName("roleadd").setDescription("➕ Add a role to a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),
  new SlashCommandBuilder().setName("roleremove").setDescription("➖ Remove a role from a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),
  new SlashCommandBuilder().setName("channellock").setDescription("🔒 Lock a channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("channelunlock").setDescription("🔓 Unlock a channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("lockdown").setDescription("🔐 Emergency: lock ALL channels")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("unlock").setDescription("🔓 Unlock all channels after lockdown")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("antilink").setDescription("🔗 Toggle auto-deletion of Discord invite links")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("action").setDescription("Enable or disable").setRequired(true)
      .addChoices({ name: "Enable", value: "on" }, { name: "Disable", value: "off" })),
  new SlashCommandBuilder().setName("scan").setDescription("🔍 Scan for suspicious/fake accounts")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("masscheck").setDescription("🔎 Auto-kick all detected fake accounts")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("shield").setDescription("🛡️ Shield a channel from nuke attacks")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("unshield").setDescription("Remove shield from a channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("shieldlist").setDescription("📋 List all shielded channels")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  // Bot Owner
  new SlashCommandBuilder().setName("addsubscription").setDescription("✅ [Owner] Activate subscription for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("removesubscription").setDescription("❌ [Owner] Remove subscription from a server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("serverid").setDescription("Server ID").setRequired(true)),
  new SlashCommandBuilder().setName("listsubscriptions").setDescription("📋 [Owner] List all active subscriptions")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("botinfo").setDescription("📊 [Owner] Bot stats and uptime")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("serverlist").setDescription("🌐 [Owner] All servers the bot is in")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("globalban").setDescription("🌐🔨 [Owner] Ban a user from ALL subscribed servers")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("blacklist").setDescription("⛔ [Owner] Add user to global blacklist")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)),
  new SlashCommandBuilder().setName("unblacklist").setDescription("✅ [Owner] Remove user from global blacklist")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)),
  new SlashCommandBuilder().setName("blacklistcheck").setDescription("📋 [Owner] View the global blacklist")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("dm").setDescription("💬 [Owner] DM any user through the bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Message").setRequired(true)),
  new SlashCommandBuilder().setName("news").setDescription("📰 [Owner] Broadcast news to all subscribers")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("message").setDescription("News message").setRequired(true)),
  new SlashCommandBuilder().setName("leak").setDescription("⚠️ [Owner] Broadcast a leak/warning to all subscribers")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("message").setDescription("Leak message").setRequired(true)),
  new SlashCommandBuilder().setName("announce").setDescription("📣 [Owner] Custom broadcast to all subscribers")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("message").setDescription("Text").setRequired(true))
    .addStringOption(o => o.setName("type").setDescription("Type").setRequired(false)
      .addChoices(
        { name: "📣 General", value: "general" },
        { name: "🚨 Urgent", value: "urgent" },
        { name: "💡 Feature Update", value: "update" },
        { name: "⚠️ Leak / Warning", value: "leak" },
        { name: "📰 News", value: "news" }
      )),
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
  } catch { /* ignore */ }
}

async function alertOwner(client: Client, guildId: string, title: string, desc: string, danger: boolean) {
  const oid = db.ownerIds[guildId];
  if (!oid) return;
  try {
    await (await client.users.fetch(oid)).send({
      embeds: [new EmbedBuilder()
        .setColor(danger ? 0xed4245 : 0x57f287)
        .setTitle(danger ? `🚨 ${title}` : `✅ ${title}`)
        .setDescription(desc)
        .setTimestamp()
        .setFooter({ text: "SaftyBot Protection" })]
    });
  } catch { /* ignore */ }
}

async function broadcastToSubscribers(client: Client, embed: EmbedBuilder) {
  let dmSent = 0, dmFailed = 0, channelSent = 0;
  for (const gid of Object.keys(db.subscriptions)) {
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;
    const oid = db.ownerIds[gid];
    if (oid) { try { await (await client.users.fetch(oid)).send({ embeds: [embed] }); dmSent++; } catch { dmFailed++; } }
    try { const sys = guild.systemChannel; if (sys) { await sys.send({ embeds: [embed] }); channelSent++; } } catch { /* ignore */ }
  }
  return { dmSent, dmFailed, channelSent };
}

async function requireSub(i: ChatInputCommandInteraction): Promise<boolean> {
  if (i.user.id === BOT_OWNER_ID) return true;
  if (!i.guildId || !hasSubscription(i.guildId)) {
    await i.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle("🔒 Subscription Required")
        .setDescription("This command requires an active subscription.\nUse `/subscribe` to activate full protection!\n\n💡 Not sure what you get? Try `/features`!")],
      ephemeral: true
    });
    return false;
  }
  return true;
}

async function requireBotOwner(i: ChatInputCommandInteraction): Promise<boolean> {
  if (i.user.id !== BOT_OWNER_ID) {
    await i.reply({ content: "❌ Only the bot owner can use this.", ephemeral: true });
    return false;
  }
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
      embeds: [new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle("💰 New Subscription Request!")
        .setDescription("Someone wants to subscribe to SaftyBot!")
        .addFields(
          { name: "👤 User", value: `**${userTag}** (<@${userId}>) \`${userId}\``, inline: true },
          { name: "🌐 Server", value: `**${guildName}** (\`${guildId}\`)`, inline: true },
          { name: "💳 Payment Info", value: `Awaiting **${PRICE_EGP} EGP** via InstaPay to \`${INSTAPAY_NUMBER}\`\n\nCheck your InstaPay app, then click **Accept** or **Decline**.` }
        )
        .setTimestamp()
        .setFooter({ text: "Tap a button to respond" })],
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
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Subscription Accepted!").setDescription(`**${pending.guildName}** (${pending.userTag}) activated — expires ${new Date(expiresAt).toLocaleDateString()}!`).setTimestamp()],
      components: []
    });
    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🎉 Subscription Activated!").setDescription(`Your subscription for **${pending.guildName}** has been **approved**! Full protection is now active. 😊\n\nRun \`/setowner\` to receive direct security alerts.\n\n📅 Expires: **${new Date(expiresAt).toLocaleDateString()}**`).setTimestamp().setFooter({ text: "SaftyBot — Always Watching" })] });
    } catch { /* ignore */ }
    const guild = client.guilds.cache.get(guildId);
    guild?.systemChannel?.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🎉 SaftyBot Protection ACTIVATED!").setDescription("Full server protection is now active! Run `/status` to see everything protecting you. 💪").setTimestamp()] }).catch(() => { /* ignore */ });
  } else {
    delete db.pendingSubscriptions[key];
    saveData(db);
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Subscription Declined").setDescription(`Request from **${pending.userTag}** for **${pending.guildName}** declined.`).setTimestamp()],
      components: []
    });
    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Subscription Not Approved").setDescription(`Your request for **${pending.guildName}** was not approved.\n\nIf you've already paid, contact **@${OWNER_CONTACT}** with your payment screenshot and server ID \`${guildId}\`.`).setTimestamp().setFooter({ text: "SaftyBot Support" })] });
    } catch { /* ignore */ }
  }
}

// ─── Subscription Expiry Checker ──────────────────────────────────────────────
async function checkSubscriptionExpiry(client: Client) {
  const now = new Date();
  for (const [guildId, sub] of Object.entries(db.subscriptions)) {
    if (!sub.expiresAt) continue;
    const expiresAt = new Date(sub.expiresAt);
    const daysLeft = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    if (daysLeft <= 3 && daysLeft > 0 && !renewalNotified.has(guildId)) {
      renewalNotified.add(guildId);
      const ownerId = db.ownerIds[guildId];
      if (ownerId) {
        try {
          const user = await client.users.fetch(ownerId);
          await user.send({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("⚠️ Subscription Expiring Soon!").setDescription(`Your SaftyBot subscription expires in **${Math.ceil(daysLeft)} day(s)** (${expiresAt.toLocaleDateString()})!\n\nTo renew:\n1. Send **${PRICE_EGP} EGP** via InstaPay to \`${INSTAPAY_NUMBER}\`\n2. Send the screenshot to **@${OWNER_CONTACT}**\n\nDon't let your protection lapse! 🛡️`).setTimestamp().setFooter({ text: "SaftyBot — Renewal Notice" })] });
        } catch { /* ignore */ }
      }
    }

    if (daysLeft <= 0) {
      const ownerId = db.ownerIds[guildId];
      delete db.subscriptions[guildId];
      renewalNotified.delete(guildId);
      saveData(db);
      if (ownerId) {
        try {
          const user = await client.users.fetch(ownerId);
          await user.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Subscription Expired").setDescription(`Your SaftyBot subscription has **expired**. Your server is no longer protected.\n\nTo reactivate:\n1. Send **${PRICE_EGP} EGP** via InstaPay to \`${INSTAPAY_NUMBER}\`\n2. Contact **@${OWNER_CONTACT}** with your payment screenshot.`).setTimestamp().setFooter({ text: "SaftyBot — Subscription Expired" })] });
        } catch { /* ignore */ }
      }
      const guild = client.guilds.cache.get(guildId);
      guild?.systemChannel?.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("⚠️ SaftyBot Protection Expired").setDescription("This server's subscription has expired. Contact **@7d35** to renew and restore full protection.").setTimestamp()] }).catch(() => { /* ignore */ });
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
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("✨ SaftyBot — Full Feature List").setDescription(sub ? "✅ Your server has **full protection active!**" : `❌ **Not subscribed** — use \`/subscribe\`.\nOnly **${PRICE_EGP} EGP/month** via InstaPay to \`${INSTAPAY_NUMBER}\``)
    .addFields(
      { name: "🛡️ Anti-Spam", value: "Auto-mutes anyone sending 6+ messages in 5 seconds." },
      { name: "💣 Anti-Nuke", value: "Auto-bans users performing 3+ destructive actions in 10s." },
      { name: "🚪 Anti-Raid", value: "Detects 8+ joins in 10s and immediately DMs the server owner." },
      { name: "🤖 Fake Account Detection", value: "Auto-kicks accounts <7 days old with no avatar on join." },
      { name: "🔗 Anti-Link", value: "Auto-deletes Discord invite links. Toggle with `/antilink`." },
      { name: "🔇 Anti-Mention Spam", value: `Auto-mutes anyone who mass-mentions ${MENTION_LIMIT}+ users or abuses @everyone/@here.` },
      { name: "🤬 Word Filter", value: "Auto-deletes messages with banned words. Configurable with `/addword`." },
      { name: "📋 Action Logs", value: "Every bot action is logged to a dedicated channel in real time." },
      { name: "🎉 Custom Welcome", value: "Personalized welcome messages for new members." },
      { name: "⏳ Auto-Renewal Reminders", value: "Bot DMs the server owner 3 days before subscription expires." },
      { name: "🛡️ Channel Shields", value: "Shield important channels from deletion attacks." },
      { name: "📩 Owner Alerts", value: "Instant DM alerts for security events." },
      { name: "🔨 Full Moderation Suite", value: "`/ban` `/tempban` `/kick` `/mute` `/unmute` `/unban` `/purge` `/warn` `/slowmode` `/lockdown` `/channellock` `/scan` `/masscheck`" },
      { name: "🎯 Member Tools", value: "`/poll` `/remind` `/afk` `/snipe` `/8ball` `/coinflip` `/dice` `/math` `/avatar`" },
      { name: "💰 Price", value: `**$${PRICE_USD}/month (${PRICE_EGP} EGP)** — InstaPay to \`${INSTAPAY_NUMBER}\`` }
    )
    .setFooter({ text: "SaftyBot — Smart, Strong, Always Watching 💪" }).setTimestamp()] });
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
    { name: "🔒 Channel Control", value: "`/channellock` `/channelunlock` `/lockdown` `/unlock` `/antilink` `/shield` `/unshield` `/shieldlist`" },
    { name: "🔍 Security", value: "`/scan` `/masscheck`" },
    { name: "👑 Owner Only", value: "`/addsubscription` `/removesubscription` `/listsubscriptions` `/botinfo` `/serverlist` `/globalban` `/blacklist` `/unblacklist` `/blacklistcheck` `/dm` `/news` `/leak` `/announce`" },
    { name: "💳 Subscription", value: `Use \`/subscribe\` to get full access! **${PRICE_EGP} EGP/month** only.` }
  ).setFooter({ text: "SaftyBot — Always Watching 👁️" }).setTimestamp()] });
}

async function handleStatus(i: ChatInputCommandInteraction) {
  if (!i.guildId) { await i.reply({ content: "❌ This command must be used in a server.", ephemeral: true }); return; }
  const sub = hasSubscription(i.guildId);
  const subData = db.subscriptions[i.guildId];
  const antilink = isAntilinkEnabled(i.guildId);
  const shielded = db.shieldedChannels[i.guildId] ?? [];
  const logCh = db.logChannels[i.guildId];
  const ownerId = db.ownerIds[i.guildId];

  await i.reply({ embeds: [new EmbedBuilder()
    .setColor(sub ? 0x57f287 : 0xed4245)
    .setTitle(`🛡️ Server Protection Status — ${sub ? "ACTIVE ✅" : "INACTIVE ❌"}`)
    .addFields(
      { name: "💳 Subscription", value: sub ? `Active until **${new Date(subData!.expiresAt).toLocaleDateString()}**` : "❌ Not subscribed — use `/subscribe`", inline: false },
      { name: "🔗 Anti-Link", value: antilink ? "✅ Enabled" : "❌ Disabled", inline: true },
      { name: "🛡️ Shielded Channels", value: shielded.length > 0 ? `${shielded.length} channel(s)` : "None", inline: true },
      { name: "📋 Log Channel", value: logCh ? `<#${logCh}>` : "Not set", inline: true },
      { name: "📩 Owner Alerts", value: ownerId ? `<@${ownerId}>` : "Not set — use `/setowner`", inline: true },
      { name: "🛡️ Auto Protections", value: sub ? "✅ Anti-Spam\n✅ Anti-Nuke\n✅ Anti-Raid\n✅ Fake Account Detection\n✅ Word Filter" : "❌ All disabled (no subscription)", inline: false }
    )
    .setTimestamp()] });
}

async function handleSubscribe(i: ChatInputCommandInteraction) {
  if (!i.guildId) { await i.reply({ content: "❌ Use this in a server.", ephemeral: true }); return; }
  if (hasSubscription(i.guildId)) {
    const sub = db.subscriptions[i.guildId];
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Already Subscribed!").setDescription(`This server already has an active subscription until **${new Date(sub!.expiresAt).toLocaleDateString()}**!`).setTimestamp()], ephemeral: true });
    return;
  }
  const key = `${i.guildId}_${i.user.id}`;
  if (db.pendingSubscriptions[key]) {
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("⏳ Pending Subscription").setDescription("You already have a pending subscription request! The bot owner will respond soon.")], ephemeral: true });
    return;
  }
  await sendSubscriptionRequest(i.client, i.guildId, i.user.id, i.guild?.name ?? "Unknown", i.user.tag, i.user.username);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("💳 Subscription Request Sent!").setDescription(`To activate SaftyBot for **${i.guild?.name}**:\n\n1. Send **${PRICE_EGP} EGP** via InstaPay to:\n\`\`\`${INSTAPAY_NUMBER}\`\`\`\n2. Send the payment screenshot to **@${OWNER_CONTACT}**\n3. The bot owner will approve your request shortly!\n\n💡 Questions? Contact **@${OWNER_CONTACT}**`).setTimestamp().setFooter({ text: "SaftyBot — Awaiting Payment Confirmation" })], ephemeral: true });
}

async function handleInvite(i: ChatInputCommandInteraction) {
  const clientId = i.client.user?.id ?? "";
  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📨 Invite SaftyBot").setDescription(`[Click here to invite SaftyBot](${inviteUrl})\n\nBring full server protection to your community! 💪`).setTimestamp()] });
}

async function handleUptime(i: ChatInputCommandInteraction) {
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏱️ Bot Uptime").addFields({ name: "Running for", value: formatUptime(Date.now() - BOT_START_TIME) }).setTimestamp()] });
}

async function handleServerInfo(i: ChatInputCommandInteraction) {
  const g = i.guild;
  if (!g) { await i.reply({ content: "❌ Use this in a server.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📊 ${g.name}`)
    .setThumbnail(g.iconURL())
    .addFields(
      { name: "👑 Owner", value: `<@${g.ownerId}>`, inline: true },
      { name: "👥 Members", value: `${g.memberCount}`, inline: true },
      { name: "📅 Created", value: g.createdAt.toLocaleDateString(), inline: true },
      { name: "🌍 Region", value: g.preferredLocale, inline: true },
      { name: "💬 Channels", value: `${g.channels.cache.size}`, inline: true },
      { name: "🎭 Roles", value: `${g.roles.cache.size}`, inline: true },
      { name: "🆔 ID", value: g.id, inline: false }
    )
    .setTimestamp()] });
}

async function handleUserInfo(i: ChatInputCommandInteraction) {
  const target = i.options.getUser("user") ?? i.user;
  const member = i.guild?.members.cache.get(target.id);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`👤 ${target.tag}`)
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "🆔 ID", value: target.id, inline: true },
      { name: "📅 Account Created", value: target.createdAt.toLocaleDateString(), inline: true },
      { name: "📥 Joined Server", value: member?.joinedAt?.toLocaleDateString() ?? "N/A", inline: true },
      { name: "🤖 Bot", value: target.bot ? "Yes" : "No", inline: true },
      { name: "⚠️ Blacklisted", value: isBlacklisted(target.id) ? "⛔ Yes" : "✅ No", inline: true },
      { name: "⚠️ Warnings", value: `${(i.guildId ? db.warnings[i.guildId]?.[target.id] : 0) ?? 0}`, inline: true }
    )
    .setTimestamp()] });
}

async function handleAvatar(i: ChatInputCommandInteraction) {
  const target = i.options.getUser("user") ?? i.user;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🖼️ ${target.username}'s Avatar`).setImage(target.displayAvatarURL({ size: 4096 })).setTimestamp()] });
}

async function handleColor(i: ChatInputCommandInteraction) {
  const hex = i.options.getString("hex", true).replace("#", "").trim();
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) { await i.reply({ content: "❌ Invalid hex code. Example: `FF5733`", ephemeral: true }); return; }
  const color = parseInt(hex, 16);
  await i.reply({ embeds: [new EmbedBuilder().setColor(color).setTitle(`🎨 Color Preview — #${hex.toUpperCase()}`).setDescription(`Hex: \`#${hex.toUpperCase()}\`\nDecimal: \`${color}\`\nRGB: \`${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}\``).setTimestamp()] });
}

async function handle8Ball(i: ChatInputCommandInteraction) {
  const answers = [
    "🟢 It is certain.", "🟢 It is decidedly so.", "🟢 Without a doubt.", "🟢 Yes, definitely.",
    "🟢 You may rely on it.", "🟢 As I see it, yes.", "🟢 Most likely.", "🟢 Outlook good.",
    "🟡 Reply hazy, try again.", "🟡 Ask again later.", "🟡 Better not tell you now.", "🟡 Cannot predict now.",
    "🔴 Don't count on it.", "🔴 My reply is no.", "🔴 My sources say no.", "🔴 Outlook not so good.", "🔴 Very doubtful."
  ];
  const q = i.options.getString("question", true);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎱 Magic 8-Ball").addFields({ name: "❓ Question", value: q }, { name: "🎱 Answer", value: answers[Math.floor(Math.random() * answers.length)] }).setTimestamp()] });
}

async function handleCoinFlip(i: ChatInputCommandInteraction) {
  const result = Math.random() < 0.5 ? "🪙 Heads!" : "🪙 Tails!";
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🪙 Coin Flip").setDescription(result).setTimestamp()] });
}

async function handleDice(i: ChatInputCommandInteraction) {
  const sides = i.options.getInteger("sides") ?? 6;
  if (sides < 2) { await i.reply({ content: "❌ A dice needs at least 2 sides.", ephemeral: true }); return; }
  const roll = Math.floor(Math.random() * sides) + 1;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎲 Dice Roll").setDescription(`You rolled a **${roll}** (d${sides})`).setTimestamp()] });
}

async function handleMath(i: ChatInputCommandInteraction) {
  const expr = i.options.getString("expression", true);
  try {
    const clean = expr.replace(/[^0-9+\-*/().\s%]/g, "");
    if (!clean.trim()) { await i.reply({ content: "❌ Invalid expression.", ephemeral: true }); return; }
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${clean})`)();
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🧮 Math Result").addFields({ name: "Expression", value: `\`${expr}\`` }, { name: "Result", value: `\`${result}\`` }).setTimestamp()] });
  } catch {
    await i.reply({ content: "❌ Could not evaluate that expression.", ephemeral: true });
  }
}

async function handleRemind(i: ChatInputCommandInteraction) {
  const minutes = i.options.getInteger("minutes", true);
  const msg = i.options.getString("message", true);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("⏰ Reminder Set!").setDescription(`I'll remind you in **${minutes} minute(s)**: ${msg}`).setTimestamp()], ephemeral: true });
  setTimeout(async () => {
    try {
      await i.user.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("⏰ Reminder!").setDescription(msg).setTimestamp().setFooter({ text: "SaftyBot Reminder" })] });
    } catch { /* ignore */ }
  }, minutes * 60 * 1000);
}

async function handleAfk(i: ChatInputCommandInteraction) {
  const reason = i.options.getString("reason") ?? "AFK";
  db.afkUsers[i.user.id] = { reason, since: new Date().toISOString() };
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("💤 AFK Set").setDescription(`You are now AFK: **${reason}**`).setTimestamp()], ephemeral: true });
}

async function handlePoll(i: ChatInputCommandInteraction) {
  const q = i.options.getString("question", true);
  const opt1 = i.options.getString("option1", true);
  const opt2 = i.options.getString("option2", true);
  const opt3 = i.options.getString("option3");
  const opt4 = i.options.getString("option4");
  const options = [opt1, opt2, opt3, opt4].filter(Boolean) as string[];
  const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
  const desc = options.map((o, idx) => `${emojis[idx]} ${o}`).join("\n");
  const reply = await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📊 ${q}`).setDescription(desc).setFooter({ text: `Poll by ${i.user.tag}` }).setTimestamp()], fetchReply: true });
  for (let idx = 0; idx < options.length; idx++) {
    try { await reply.react(emojis[idx]); } catch { /* ignore */ }
  }
}

async function handleReport(i: ChatInputCommandInteraction) {
  const target = i.options.getUser("user", true);
  const reason = i.options.getString("reason", true);
  if (!i.guildId) { await i.reply({ content: "❌ Use in a server.", ephemeral: true }); return; }
  const logCh = db.logChannels[i.guildId];
  if (logCh) {
    const ch = i.guild?.channels.cache.get(logCh) as TextChannel;
    if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🚨 User Report").addFields({ name: "Reported User", value: `${target.tag} (${target.id})` }, { name: "Reported By", value: `${i.user.tag}` }, { name: "Reason", value: reason }).setTimestamp()] }).catch(() => { /* ignore */ });
  }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Report Submitted").setDescription(`Your report against **${target.tag}** has been sent to the moderation team.`).setTimestamp()], ephemeral: true });
}

async function handleSnipe(i: ChatInputCommandInteraction) {
  const snap = sniped.get(i.channelId);
  if (!snap) { await i.reply({ content: "❌ No recently deleted messages to snipe.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("👻 Sniped Message").setDescription(snap.content).setAuthor({ name: snap.author, iconURL: snap.avatar }).setFooter({ text: `Deleted at ${snap.at.toLocaleTimeString()}` }).setTimestamp(snap.at)] });
}

async function handleEditSnipe(i: ChatInputCommandInteraction) {
  const snap = editSniped.get(i.channelId);
  if (!snap) { await i.reply({ content: "❌ No recently edited messages to snipe.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("✏️ Edit Sniped").addFields({ name: "Before", value: snap.before }, { name: "After", value: snap.after }).setAuthor({ name: snap.author }).setFooter({ text: `Edited at ${snap.at.toLocaleTimeString()}` }).setTimestamp(snap.at)] });
}

async function handleServerRank(i: ChatInputCommandInteraction) {
  if (!i.guildId) { await i.reply({ content: "❌ Use in a server.", ephemeral: true }); return; }
  const warns = db.warnings[i.guildId] ?? {};
  const sorted = Object.entries(warns).sort(([, a], [, b]) => b - a);
  const myPos = sorted.findIndex(([uid]) => uid === i.user.id);
  const myWarns = warns[i.user.id] ?? 0;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🏆 Your Server Warning Rank").addFields({ name: "Your Warnings", value: `${myWarns}`, inline: true }, { name: "Your Rank", value: myPos >= 0 ? `#${myPos + 1} of ${sorted.length}` : "Unranked", inline: true }).setTimestamp()] });
}

// ─── Moderation Commands ──────────────────────────────────────────────────────
async function handleWarn(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  if (!i.guildId) return;
  const target = i.options.getUser("user", true);
  const reason = i.options.getString("reason") ?? "No reason provided";
  const count = addWarning(i.guildId, target.id);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("⚠️ User Warned").addFields({ name: "User", value: `${target.tag}`, inline: true }, { name: "Warnings", value: `${count}`, inline: true }, { name: "Reason", value: reason }).setTimestamp()] });
  await logAction(i.client, i.guildId, "⚠️ User Warned", `**${target.tag}** warned by **${i.user.tag}**\nReason: ${reason}\nTotal warnings: ${count}`, 0xfee75c);
}

async function handleWarnings(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  if (!i.guildId) return;
  const target = i.options.getUser("user", true);
  const count = db.warnings[i.guildId]?.[target.id] ?? 0;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(`📋 Warnings for ${target.tag}`).setDescription(`**${count}** warning(s)`).setTimestamp()] });
}

async function handleClearWarns(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  if (!i.guildId) return;
  const target = i.options.getUser("user", true);
  if (db.warnings[i.guildId]) delete db.warnings[i.guildId][target.id];
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🗑️ Warnings Cleared").setDescription(`All warnings cleared for **${target.tag}**`).setTimestamp()] });
}

async function handleMute(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember | null;
  const minutes = i.options.getInteger("minutes") ?? 10;
  if (!target) { await i.reply({ content: "❌ User not found.", ephemeral: true }); return; }
  try {
    await target.timeout(minutes * 60 * 1000, `Muted by ${i.user.tag}`);
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🔇 User Muted").addFields({ name: "User", value: target.user.tag, inline: true }, { name: "Duration", value: `${minutes} minute(s)`, inline: true }).setTimestamp()] });
    if (i.guildId) await logAction(i.client, i.guildId, "🔇 User Muted", `**${target.user.tag}** muted for ${minutes}min by **${i.user.tag}**`, 0xfee75c);
  } catch {
    await i.reply({ content: "❌ Could not mute that user. Check my permissions.", ephemeral: true });
  }
}

async function handleUnmute(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember | null;
  if (!target) { await i.reply({ content: "❌ User not found.", ephemeral: true }); return; }
  try {
    await target.timeout(null);
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🔊 User Unmuted").setDescription(`**${target.user.tag}** has been unmuted.`).setTimestamp()] });
  } catch {
    await i.reply({ content: "❌ Could not unmute that user.", ephemeral: true });
  }
}

async function handleKick(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember | null;
  const reason = i.options.getString("reason") ?? "No reason provided";
  if (!target) { await i.reply({ content: "❌ User not found.", ephemeral: true }); return; }
  try {
    await target.kick(reason);
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("👢 User Kicked").addFields({ name: "User", value: target.user.tag, inline: true }, { name: "Reason", value: reason }).setTimestamp()] });
    if (i.guildId) await logAction(i.client, i.guildId, "👢 User Kicked", `**${target.user.tag}** kicked by **${i.user.tag}**\nReason: ${reason}`, 0xed4245);
  } catch {
    await i.reply({ content: "❌ Could not kick that user.", ephemeral: true });
  }
}

async function handleBan(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember | null;
  const reason = i.options.getString("reason") ?? "No reason provided";
  if (!target) { await i.reply({ content: "❌ User not found.", ephemeral: true }); return; }
  try {
    await target.ban({ reason });
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔨 User Banned").addFields({ name: "User", value: target.user.tag, inline: true }, { name: "Reason", value: reason }).setTimestamp()] });
    if (i.guildId) await logAction(i.client, i.guildId, "🔨 User Banned", `**${target.user.tag}** banned by **${i.user.tag}**\nReason: ${reason}`, 0xed4245);
  } catch {
    await i.reply({ content: "❌ Could not ban that user.", ephemeral: true });
  }
}

async function handleTempBan(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember | null;
  const minutes = i.options.getInteger("minutes", true);
  const reason = i.options.getString("reason") ?? "No reason provided";
  if (!target) { await i.reply({ content: "❌ User not found.", ephemeral: true }); return; }
  try {
    await target.ban({ reason: `[TempBan: ${minutes}min] ${reason}` });
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("⏱️ Temp Banned").addFields({ name: "User", value: target.user.tag, inline: true }, { name: "Duration", value: `${minutes} minute(s)`, inline: true }, { name: "Reason", value: reason }).setTimestamp()] });
    setTimeout(async () => {
      try { await i.guild?.bans.remove(target.user.id, "Temp ban expired"); } catch { /* ignore */ }
    }, minutes * 60 * 1000);
  } catch {
    await i.reply({ content: "❌ Could not temp-ban that user.", ephemeral: true });
  }
}

async function handleUnban(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const userId = i.options.getString("userid", true);
  try {
    await i.guild?.bans.remove(userId, `Unbanned by ${i.user.tag}`);
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🔓 User Unbanned").setDescription(`User \`${userId}\` has been unbanned.`).setTimestamp()] });
  } catch {
    await i.reply({ content: "❌ Could not unban that user ID.", ephemeral: true });
  }
}

async function handlePurge(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const amount = Math.min(Math.max(i.options.getInteger("amount", true), 1), 100);
  const filterUser = i.options.getUser("user");
  const channel = i.channel as TextChannel;
  try {
    let messages = await channel.messages.fetch({ limit: amount + 1 });
    if (filterUser) messages = messages.filter(m => m.author.id === filterUser.id);
    const toPurge = [...messages.values()].slice(0, amount);
    const deleted = await channel.bulkDelete(toPurge, true);
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🗑️ Messages Purged").setDescription(`Deleted **${deleted.size}** message(s)${filterUser ? ` from **${filterUser.tag}**` : ""}.`).setTimestamp()], ephemeral: true });
  } catch {
    await i.reply({ content: "❌ Could not purge messages.", ephemeral: true });
  }
}

async function handleSlowmode(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const seconds = i.options.getInteger("seconds", true);
  const target = (i.options.getChannel("channel") ?? i.channel) as TextChannel;
  try {
    await target.setRateLimitPerUser(seconds);
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🐢 Slowmode Updated").setDescription(seconds === 0 ? `Slowmode disabled in <#${target.id}>` : `Slowmode set to **${seconds}s** in <#${target.id}>`).setTimestamp()] });
  } catch {
    await i.reply({ content: "❌ Could not set slowmode.", ephemeral: true });
  }
}

async function handleRoleAdd(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember | null;
  const role = i.options.getRole("role", true);
  if (!target) { await i.reply({ content: "❌ User not found.", ephemeral: true }); return; }
  try {
    await target.roles.add(role.id);
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("➕ Role Added").setDescription(`Added **${role.name}** to **${target.user.tag}**`).setTimestamp()] });
  } catch {
    await i.reply({ content: "❌ Could not add role.", ephemeral: true });
  }
}

async function handleRoleRemove(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getMember("user") as GuildMember | null;
  const role = i.options.getRole("role", true);
  if (!target) { await i.reply({ content: "❌ User not found.", ephemeral: true }); return; }
  try {
    await target.roles.remove(role.id);
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("➖ Role Removed").setDescription(`Removed **${role.name}** from **${target.user.tag}**`).setTimestamp()] });
  } catch {
    await i.reply({ content: "❌ Could not remove role.", ephemeral: true });
  }
}

async function handleChannelLock(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const channel = i.options.getChannel("channel", true) as TextChannel;
  try {
    await channel.permissionOverwrites.edit(i.guild!.roles.everyone, { SendMessages: false });
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔒 Channel Locked").setDescription(`<#${channel.id}> has been locked.`).setTimestamp()] });
    await logAction(i.client, i.guildId!, "🔒 Channel Locked", `<#${channel.id}> locked by **${i.user.tag}**`, 0xed4245);
  } catch {
    await i.reply({ content: "❌ Could not lock channel.", ephemeral: true });
  }
}

async function handleChannelUnlock(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const channel = i.options.getChannel("channel", true) as TextChannel;
  try {
    await channel.permissionOverwrites.edit(i.guild!.roles.everyone, { SendMessages: null });
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🔓 Channel Unlocked").setDescription(`<#${channel.id}> has been unlocked.`).setTimestamp()] });
  } catch {
    await i.reply({ content: "❌ Could not unlock channel.", ephemeral: true });
  }
}

async function handleLockdown(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  if (!i.guild) return;
  await i.deferReply();
  const textChannels = i.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
  let count = 0;
  for (const [, ch] of textChannels) {
    try { await (ch as TextChannel).permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false }); count++; } catch { /* ignore */ }
  }
  await i.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔐 Server Lockdown").setDescription(`Locked **${count}** channels. Use \`/unlock\` to restore access.`).setTimestamp()] });
  await logAction(i.client, i.guildId!, "🔐 Server Lockdown", `Lockdown activated by **${i.user.tag}** — ${count} channels locked`, 0xed4245);
  await alertOwner(i.client, i.guildId!, "Server Lockdown Activated", `**${i.user.tag}** activated lockdown on **${i.guild.name}**.`, true);
}

async function handleUnlock(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  if (!i.guild) return;
  await i.deferReply();
  const textChannels = i.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
  let count = 0;
  for (const [, ch] of textChannels) {
    try { await (ch as TextChannel).permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null }); count++; } catch { /* ignore */ }
  }
  await i.editReply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🔓 Server Unlocked").setDescription(`Unlocked **${count}** channels.`).setTimestamp()] });
}

async function handleAntilink(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  if (!i.guildId) return;
  const action = i.options.getString("action", true);
  if (action === "on") {
    if (!db.antilinkGuilds.includes(i.guildId)) db.antilinkGuilds.push(i.guildId);
  } else {
    db.antilinkGuilds = db.antilinkGuilds.filter(g => g !== i.guildId);
  }
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(action === "on" ? 0x57f287 : 0xed4245).setTitle("🔗 Anti-Link").setDescription(`Anti-link is now **${action === "on" ? "enabled" : "disabled"}**`).setTimestamp()] });
}

async function handleScan(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  if (!i.guild) return;
  await i.deferReply();
  const members = await i.guild.members.fetch();
  const suspicious: GuildMember[] = [];
  const now = Date.now();
  for (const [, m] of members) {
    if (m.user.bot) continue;
    const ageMs = now - m.user.createdTimestamp;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < FAKE_ACCOUNT_DAYS && !m.user.avatar) suspicious.push(m);
  }
  await i.editReply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🔍 Scan Results").setDescription(suspicious.length === 0 ? "✅ No suspicious accounts found!" : `⚠️ Found **${suspicious.length}** suspicious account(s):\n${suspicious.slice(0, 20).map(m => `• ${m.user.tag} (${m.user.id})`).join("\n")}`).setTimestamp()] });
}

async function handleMassCheck(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  if (!i.guild) return;
  await i.deferReply();
  const members = await i.guild.members.fetch();
  const now = Date.now();
  let kicked = 0;
  for (const [, m] of members) {
    if (m.user.bot) continue;
    const ageDays = (now - m.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (ageDays < FAKE_ACCOUNT_DAYS && !m.user.avatar) {
      try { await m.kick("Auto-kicked: suspected fake account"); kicked++; } catch { /* ignore */ }
    }
  }
  await i.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔎 Mass Check Complete").setDescription(kicked === 0 ? "✅ No suspicious accounts found." : `Kicked **${kicked}** suspected fake account(s).`).setTimestamp()] });
  await logAction(i.client, i.guildId!, "🔎 Mass Check", `**${i.user.tag}** ran mass check — ${kicked} accounts kicked`, 0xed4245);
}

async function handleShield(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  if (!i.guildId) return;
  const channel = i.options.getChannel("channel", true);
  if (!db.shieldedChannels[i.guildId]) db.shieldedChannels[i.guildId] = [];
  if (!db.shieldedChannels[i.guildId].includes(channel.id)) db.shieldedChannels[i.guildId].push(channel.id);
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🛡️ Channel Shielded").setDescription(`<#${channel.id}> is now shielded from nuke attacks.`).setTimestamp()] });
}

async function handleUnshield(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  if (!i.guildId) return;
  const channel = i.options.getChannel("channel", true);
  if (db.shieldedChannels[i.guildId]) db.shieldedChannels[i.guildId] = db.shieldedChannels[i.guildId].filter(c => c !== channel.id);
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🛡️ Shield Removed").setDescription(`<#${channel.id}> is no longer shielded.`).setTimestamp()] });
}

async function handleShieldList(i: ChatInputCommandInteraction) {
  if (!i.guildId) return;
  const shielded = db.shieldedChannels[i.guildId] ?? [];
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Shielded Channels").setDescription(shielded.length > 0 ? shielded.map(c => `<#${c}>`).join("\n") : "No shielded channels.").setTimestamp()] });
}

// ─── Setup Commands ───────────────────────────────────────────────────────────
async function handleSetOwner(i: ChatInputCommandInteraction) {
  if (!i.guildId) return;
  db.ownerIds[i.guildId] = i.user.id;
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🔑 Owner Registered").setDescription(`You (${i.user.tag}) will now receive DM alerts for security events in this server.`).setTimestamp()], ephemeral: true });
}

async function handleSetLogChannel(i: ChatInputCommandInteraction) {
  if (!i.guildId) return;
  const channel = i.options.getChannel("channel", true);
  db.logChannels[i.guildId] = channel.id;
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("📋 Log Channel Set").setDescription(`Bot actions will now be logged to <#${channel.id}>`).setTimestamp()] });
}

async function handleSetWelcome(i: ChatInputCommandInteraction) {
  if (!i.guildId) return;
  const msg = i.options.getString("message", true);
  db.welcomeMessages[i.guildId] = msg;
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🎉 Welcome Message Set").setDescription(`Welcome message updated!\n\nPreview: ${msg.replace("{user}", i.user.toString()).replace("{server}", i.guild?.name ?? "").replace("{membercount}", `${i.guild?.memberCount ?? 0}`)}`).setTimestamp()] });
}

async function handleAddWord(i: ChatInputCommandInteraction) {
  if (!i.guildId) return;
  const word = i.options.getString("word", true).toLowerCase();
  if (!db.wordFilters[i.guildId]) db.wordFilters[i.guildId] = [];
  if (!db.wordFilters[i.guildId].includes(word)) db.wordFilters[i.guildId].push(word);
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🤬 Word Added").setDescription(`\`${word}\` added to the word filter.`).setTimestamp()], ephemeral: true });
}

async function handleRemoveWord(i: ChatInputCommandInteraction) {
  if (!i.guildId) return;
  const word = i.options.getString("word", true).toLowerCase();
  if (db.wordFilters[i.guildId]) db.wordFilters[i.guildId] = db.wordFilters[i.guildId].filter(w => w !== word);
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Word Removed").setDescription(`\`${word}\` removed from the word filter.`).setTimestamp()], ephemeral: true });
}

async function handleWordList(i: ChatInputCommandInteraction) {
  if (!i.guildId) return;
  const words = db.wordFilters[i.guildId] ?? [];
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Word Filter List").setDescription(words.length > 0 ? words.map(w => `\`${w}\``).join(", ") : "No filtered words.").setTimestamp()], ephemeral: true });
}

// ─── Bot Owner Commands ───────────────────────────────────────────────────────
async function handleAddSubscription(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  if (!i.guildId) return;
  const expiresAt = new Date(Date.now() + SUB_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.subscriptions[i.guildId] = { since: new Date().toISOString(), grantedBy: BOT_OWNER_ID, expiresAt };
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Subscription Activated").setDescription(`**${i.guild?.name}** subscription activated until **${new Date(expiresAt).toLocaleDateString()}**`).setTimestamp()] });
}

async function handleRemoveSubscription(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const serverId = i.options.getString("serverid", true);
  if (db.subscriptions[serverId]) { delete db.subscriptions[serverId]; saveData(db); }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Subscription Removed").setDescription(`Subscription removed from server \`${serverId}\``).setTimestamp()] });
}

async function handleListSubscriptions(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const subs = Object.entries(db.subscriptions);
  if (subs.length === 0) { await i.reply({ content: "No active subscriptions.", ephemeral: true }); return; }
  const desc = subs.map(([gid, s]) => `**${gid}** — expires ${new Date(s.expiresAt).toLocaleDateString()}`).join("\n");
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📋 Active Subscriptions (${subs.length})`).setDescription(desc).setTimestamp()] });
}

async function handleBotInfo(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const client = i.client;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📊 Bot Info").addFields(
    { name: "🏓 Ping", value: `${Math.round(client.ws.ping)}ms`, inline: true },
    { name: "⏱️ Uptime", value: formatUptime(Date.now() - BOT_START_TIME), inline: true },
    { name: "🌐 Servers", value: `${client.guilds.cache.size}`, inline: true },
    { name: "💳 Subscriptions", value: `${Object.keys(db.subscriptions).length}`, inline: true },
    { name: "⛔ Blacklisted", value: `${db.blacklist.length}`, inline: true },
    { name: "🤖 Users", value: `${client.users.cache.size}`, inline: true }
  ).setTimestamp()] });
}

async function handleServerList(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const guilds = [...i.client.guilds.cache.values()];
  const desc = guilds.slice(0, 25).map(g => `**${g.name}** (\`${g.id}\`) — ${g.memberCount} members${hasSubscription(g.id) ? " ✅" : ""}`).join("\n");
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🌐 Server List (${guilds.length})`).setDescription(desc).setTimestamp()] });
}

async function handleGlobalBan(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  await i.deferReply();
  const userId = i.options.getString("userid", true);
  const reason = i.options.getString("reason") ?? "Global ban by bot owner";
  let banned = 0;
  for (const [gid] of Object.entries(db.subscriptions)) {
    const guild = i.client.guilds.cache.get(gid);
    if (!guild) continue;
    try { await guild.bans.create(userId, { reason }); banned++; } catch { /* ignore */ }
  }
  await i.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🌐🔨 Global Ban").setDescription(`Banned \`${userId}\` from **${banned}** server(s).\nReason: ${reason}`).setTimestamp()] });
}

async function handleBlacklist(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const userId = i.options.getString("userid", true);
  if (!db.blacklist.includes(userId)) { db.blacklist.push(userId); saveData(db); }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("⛔ User Blacklisted").setDescription(`\`${userId}\` added to global blacklist.`).setTimestamp()] });
}

async function handleUnblacklist(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const userId = i.options.getString("userid", true);
  db.blacklist = db.blacklist.filter(u => u !== userId);
  saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ User Unblacklisted").setDescription(`\`${userId}\` removed from global blacklist.`).setTimestamp()] });
}

async function handleBlacklistCheck(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📋 Global Blacklist (${db.blacklist.length})`).setDescription(db.blacklist.length > 0 ? db.blacklist.map(u => `\`${u}\``).join("\n") : "Empty.").setTimestamp()] });
}

async function handleDm(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const userId = i.options.getString("userid", true);
  const msg = i.options.getString("message", true);
  try {
    const user = await i.client.users.fetch(userId);
    await user.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📬 Message from SaftyBot").setDescription(msg).setTimestamp().setFooter({ text: "SaftyBot — Official Message" })] });
    await i.reply({ content: `✅ DM sent to \`${user.tag}\``, ephemeral: true });
  } catch {
    await i.reply({ content: "❌ Could not DM that user.", ephemeral: true });
  }
}

async function handleNews(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const msg = i.options.getString("message", true);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📰 SaftyBot News").setDescription(msg).setTimestamp().setFooter({ text: "SaftyBot Official News" });
  const result = await broadcastToSubscribers(i.client, embed);
  await i.reply({ content: `✅ Broadcast sent — ${result.dmSent} DMs, ${result.channelSent} channels`, ephemeral: true });
}

async function handleLeak(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const msg = i.options.getString("message", true);
  const embed = new EmbedBuilder().setColor(0xed4245).setTitle("⚠️ SaftyBot Security Alert").setDescription(msg).setTimestamp().setFooter({ text: "SaftyBot Security Alert" });
  const result = await broadcastToSubscribers(i.client, embed);
  await i.reply({ content: `✅ Alert sent — ${result.dmSent} DMs, ${result.channelSent} channels`, ephemeral: true });
}

async function handleAnnounce(i: ChatInputCommandInteraction) {
  if (!await requireBotOwner(i)) return;
  const msg = i.options.getString("message", true);
  const type = i.options.getString("type") ?? "general";
  const colorMap: Record<string, number> = { general: 0x5865f2, urgent: 0xed4245, update: 0x57f287, leak: 0xfee75c, news: 0x5865f2 };
  const titleMap: Record<string, string> = { general: "📣 Announcement", urgent: "🚨 Urgent Notice", update: "💡 Feature Update", leak: "⚠️ Security Warning", news: "📰 News" };
  const embed = new EmbedBuilder().setColor(colorMap[type] ?? 0x5865f2).setTitle(titleMap[type] ?? "📣 Announcement").setDescription(msg).setTimestamp().setFooter({ text: "SaftyBot Official" });
  const result = await broadcastToSubscribers(i.client, embed);
  await i.reply({ content: `✅ Announced — ${result.dmSent} DMs, ${result.channelSent} channels`, ephemeral: true });
}

// ─── Main Command Dispatcher ──────────────────────────────────────────────────
async function handleCommand(i: ChatInputCommandInteraction) {
  const cmd = i.commandName;
  if (cmd === "ping") return handlePing(i);
  if (cmd === "help") return handleHelp(i);
  if (cmd === "features") return handleFeatures(i);
  if (cmd === "status") return handleStatus(i);
  if (cmd === "subscribe") return handleSubscribe(i);
  if (cmd === "invite") return handleInvite(i);
  if (cmd === "uptime") return handleUptime(i);
  if (cmd === "serverinfo") return handleServerInfo(i);
  if (cmd === "userinfo") return handleUserInfo(i);
  if (cmd === "avatar") return handleAvatar(i);
  if (cmd === "color") return handleColor(i);
  if (cmd === "8ball") return handle8Ball(i);
  if (cmd === "coinflip") return handleCoinFlip(i);
  if (cmd === "dice") return handleDice(i);
  if (cmd === "math") return handleMath(i);
  if (cmd === "remind") return handleRemind(i);
  if (cmd === "afk") return handleAfk(i);
  if (cmd === "poll") return handlePoll(i);
  if (cmd === "report") return handleReport(i);
  if (cmd === "snipe") return handleSnipe(i);
  if (cmd === "editsnipe") return handleEditSnipe(i);
  if (cmd === "serverrank") return handleServerRank(i);
  if (cmd === "setowner") return handleSetOwner(i);
  if (cmd === "setlogchannel") return handleSetLogChannel(i);
  if (cmd === "setwelcome") return handleSetWelcome(i);
  if (cmd === "addword") return handleAddWord(i);
  if (cmd === "removeword") return handleRemoveWord(i);
  if (cmd === "wordlist") return handleWordList(i);
  if (cmd === "warn") return handleWarn(i);
  if (cmd === "warnings") return handleWarnings(i);
  if (cmd === "clearwarns") return handleClearWarns(i);
  if (cmd === "mute") return handleMute(i);
  if (cmd === "unmute") return handleUnmute(i);
  if (cmd === "kick") return handleKick(i);
  if (cmd === "ban") return handleBan(i);
  if (cmd === "tempban") return handleTempBan(i);
  if (cmd === "unban") return handleUnban(i);
  if (cmd === "purge") return handlePurge(i);
  if (cmd === "slowmode") return handleSlowmode(i);
  if (cmd === "roleadd") return handleRoleAdd(i);
  if (cmd === "roleremove") return handleRoleRemove(i);
  if (cmd === "channellock") return handleChannelLock(i);
  if (cmd === "channelunlock") return handleChannelUnlock(i);
  if (cmd === "lockdown") return handleLockdown(i);
  if (cmd === "unlock") return handleUnlock(i);
  if (cmd === "antilink") return handleAntilink(i);
  if (cmd === "scan") return handleScan(i);
  if (cmd === "masscheck") return handleMassCheck(i);
  if (cmd === "shield") return handleShield(i);
  if (cmd === "unshield") return handleUnshield(i);
  if (cmd === "shieldlist") return handleShieldList(i);
  if (cmd === "addsubscription") return handleAddSubscription(i);
  if (cmd === "removesubscription") return handleRemoveSubscription(i);
  if (cmd === "listsubscriptions") return handleListSubscriptions(i);
  if (cmd === "botinfo") return handleBotInfo(i);
  if (cmd === "serverlist") return handleServerList(i);
  if (cmd === "globalban") return handleGlobalBan(i);
  if (cmd === "blacklist") return handleBlacklist(i);
  if (cmd === "unblacklist") return handleUnblacklist(i);
  if (cmd === "blacklistcheck") return handleBlacklistCheck(i);
  if (cmd === "dm") return handleDm(i);
  if (cmd === "news") return handleNews(i);
  if (cmd === "leak") return handleLeak(i);
  if (cmd === "announce") return handleAnnounce(i);
}

// ─── Bot Bootstrap ────────────────────────────────────────────────────────────
export async function startBot() {
  if (!DISCORD_TOKEN) {
    logger.warn("DISCORD_TOKEN not set — bot will not start");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  });

  // ─── Register slash commands ──────────────────────────────────────────────
  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag }, "SaftyBot is online!");
    c.user.setActivity("🛡️ Protecting Servers", { type: ActivityType.Watching });

    try {
      const rest = new REST().setToken(DISCORD_TOKEN!);
      await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
      logger.info("Slash commands registered globally");
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }

    // Check subscriptions every hour
    setInterval(() => checkSubscriptionExpiry(c), 60 * 60 * 1000);
  });

  // ─── Interaction Handler ──────────────────────────────────────────────────
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
      } else if (interaction.isButton()) {
        if (interaction.customId.startsWith("accept_sub_") || interaction.customId.startsWith("decline_sub_")) {
          await handleSubscriptionButton(interaction as ButtonInteraction, client);
        }
      }
    } catch (err) {
      logger.error({ err }, "Error handling interaction");
    }
  });

  // ─── Message Handler (Protection) ────────────────────────────────────────
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.guild || !message.guildId) return;
    if (!hasSubscription(message.guildId)) return;

    const uid = message.author.id;
    const gid = message.guildId;

    // Blacklist check
    if (isBlacklisted(uid)) {
      try { await message.delete(); } catch { /* ignore */ }
      return;
    }

    // AFK return check
    if (db.afkUsers[uid]) {
      const afk = db.afkUsers[uid];
      delete db.afkUsers[uid];
      saveData(db);
      try {
        await message.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("👋 Welcome Back!").setDescription(`You were AFK: **${afk.reason}**\n\nSince: ${new Date(afk.since).toLocaleTimeString()}`).setTimestamp()] });
      } catch { /* ignore */ }
    }

    // Mention AFK users
    for (const [, user] of message.mentions.users) {
      if (db.afkUsers[user.id]) {
        try {
          await message.reply({ content: `💤 **${user.username}** is AFK: ${db.afkUsers[user.id].reason}` });
        } catch { /* ignore */ }
        break;
      }
    }

    // Anti-link
    if (isAntilinkEnabled(gid) && /discord\.(gg|com\/invite)\/\S+/i.test(message.content)) {
      try { await message.delete(); } catch { /* ignore */ }
      try { await (message.channel as TextChannel).send({ content: `🔗 ${message.author}, invite links are not allowed here!` }); } catch { /* ignore */ }
      return;
    }

    // Word filter
    const words = db.wordFilters[gid] ?? [];
    const contentLower = message.content.toLowerCase();
    if (words.some(w => contentLower.includes(w))) {
      try { await message.delete(); } catch { /* ignore */ }
      return;
    }

    // Anti-spam
    if (trackSpam(uid)) {
      const member = message.member;
      if (member) {
        try {
          await member.timeout(60 * 1000, "Anti-spam: too many messages");
          await (message.channel as TextChannel).send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🛡️ Anti-Spam").setDescription(`${message.author} has been muted for 1 minute for spamming.`).setTimestamp()] });
          await logAction(client, gid, "🛡️ Anti-Spam", `**${message.author.tag}** auto-muted for spam`, 0xed4245);
          await alertOwner(client, gid, "Spam Detected", `**${message.author.tag}** was muted for spamming in <#${message.channelId}>`, true);
        } catch { /* ignore */ }
      }
    }

    // Anti-mention spam
    const mentionCount = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
    if (mentionCount >= MENTION_LIMIT || message.mentions.everyone) {
      const member = message.member;
      if (member) {
        try {
          await message.delete();
          await member.timeout(5 * 60 * 1000, "Anti-mention spam");
          await (message.channel as TextChannel).send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🛡️ Anti-Mention Spam").setDescription(`${message.author} muted for 5 minutes for mention spam.`).setTimestamp()] });
          await logAction(client, gid, "🛡️ Anti-Mention", `**${message.author.tag}** muted for mention spam`, 0xed4245);
        } catch { /* ignore */ }
      }
    }
  });

  // ─── Message Delete (Snipe) ───────────────────────────────────────────────
  client.on(Events.MessageDelete, (message) => {
    if (message.author?.bot || !message.content) return;
    sniped.set(message.channelId, {
      content: message.content,
      author: message.author?.tag ?? "Unknown",
      avatar: message.author?.displayAvatarURL() ?? "",
      at: new Date(),
    });
  });

  // ─── Message Update (Edit Snipe) ──────────────────────────────────────────
  client.on(Events.MessageUpdate, (oldMsg, newMsg) => {
    if (oldMsg.author?.bot || !oldMsg.content || !newMsg.content) return;
    editSniped.set(oldMsg.channelId, {
      before: oldMsg.content,
      after: newMsg.content,
      author: oldMsg.author?.tag ?? "Unknown",
      at: new Date(),
    });
  });

  // ─── New Member (Welcome + Raid + Fake Account) ───────────────────────────
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    const gid = member.guild.id;
    if (!hasSubscription(gid)) return;

    // Blacklist check
    if (isBlacklisted(member.user.id)) {
      try { await member.kick("Globally blacklisted user"); } catch { /* ignore */ }
      return;
    }

    // Fake account detection
    const ageDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (ageDays < FAKE_ACCOUNT_DAYS && !member.user.avatar) {
      try {
        await member.kick("Suspected fake account — account too new, no avatar");
        await logAction(client, gid, "🤖 Fake Account Kicked", `**${member.user.tag}** auto-kicked (account age: ${ageDays.toFixed(1)} days, no avatar)`, 0xed4245);
        await alertOwner(client, gid, "Fake Account Detected", `**${member.user.tag}** (\`${member.user.id}\`) was auto-kicked (${ageDays.toFixed(1)} day old account, no avatar)`, true);
      } catch { /* ignore */ }
      return;
    }

    // Anti-raid detection
    if (trackJoin(gid)) {
      await alertOwner(client, gid, "Raid Alert!", `⚠️ ${RAID_THRESHOLD}+ users joined **${member.guild.name}** within 10 seconds! Possible raid!`, true);
      await logAction(client, gid, "🚪 Raid Detected", `Rapid joins detected — possible raid in progress!`, 0xed4245);
    }

    // Welcome message
    const welcomeMsg = db.welcomeMessages[gid];
    if (welcomeMsg && member.guild.systemChannel) {
      const formatted = welcomeMsg
        .replace("{user}", member.toString())
        .replace("{server}", member.guild.name)
        .replace("{membercount}", `${member.guild.memberCount}`);
      try { await member.guild.systemChannel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(formatted).setTimestamp()] }); } catch { /* ignore */ }
    }
  });

  // ─── Channel Delete (Anti-Nuke Shield) ───────────────────────────────────
  client.on(Events.ChannelDelete, async (channel) => {
    if (!("guild" in channel) || !channel.guild) return;
    const gid = channel.guild.id;
    if (!hasSubscription(gid)) return;
    if (isShielded(gid, channel.id)) {
      await alertOwner(client, gid, "Shielded Channel Deleted!", `⚠️ Shielded channel **#${channel.name ?? "unknown"}** was deleted!`, true);
      await logAction(client, gid, "🛡️ Shield Breached", `Shielded channel **#${channel.name ?? "unknown"}** was deleted!`, 0xed4245);
    }
  });

  await client.login(DISCORD_TOKEN);
}
