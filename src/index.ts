import pino from "pino";
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
  GuildMember,
  Message,
  TextChannel,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ButtonInteraction,
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
const FAKE_ACCOUNT_DAYS = 7;
const SUB_DURATION_DAYS = 30;
const BOT_START_TIME = Date.now();
const BOT_OWNER_ID = process.env["1409336978243063908"] ?? "";

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
  ts.push(now); messageLog.set(uid, ts);
  return ts.length >= SPAM_LIMIT;
}
function trackNuke(uid: string) {
  const now = Date.now();
  const e = nukeLog.get(uid) ?? { actions: [], warned: false };
  const r = e.actions.filter(t => now - t < NUKE_WINDOW_MS);
  r.push(now); nukeLog.set(uid, { actions: r, warned: e.warned });
  return r.length >= NUKE_THRESHOLD;
}
function trackJoin(gid: string) {
  const now = Date.now();
  const ts = (joinLog.get(gid) ?? []).filter(t => now - t < RAID_WINDOW_MS);
  ts.push(now); joinLog.set(gid, ts);
  return ts.length >= RAID_THRESHOLD;
}

const commands = [
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
  new SlashCommandBuilder().setName("setowner").setDescription("🔑 Register yourself for DM alerts").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("setlogchannel").setDescription("📋 Set a channel to log all bot actions").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(o => o.setName("channel").setDescription("Log channel").setRequired(true)),
  new SlashCommandBuilder().setName("setwelcome").setDescription("🎉 Set a custom welcome message").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("message").setDescription("Use {user} {server} {membercount}").setRequired(true)),
  new SlashCommandBuilder().setName("addword").setDescription("🤬 Add a word to the auto-delete filter").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("word").setDescription("Word to filter").setRequired(true)),
  new SlashCommandBuilder().setName("removeword").setDescription("✅ Remove a word from the filter").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("word").setDescription("Word to remove").setRequired(true)),
  new SlashCommandBuilder().setName("wordlist").setDescription("📋 View the word filter list").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ${m % 60}m ${s % 60}s`;
}
async function logAction(client: Client, guildId: string, title: string, description: string, color: number) {
  const ch = client.guilds.cache.get(guildId)?.channels.cache.get(db.logChannels[guildId]) as TextChannel;
  if (!ch) return;
  try { await ch.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp().setFooter({ text: "SaftyBot Action Log" })] }); } catch { }
}
async function alertOwner(client: Client, guildId: string, title: string, desc: string, danger: boolean) {
  const oid = db.ownerIds[guildId]; if (!oid) return;
  try { await (await client.users.fetch(oid)).send({ embeds: [new EmbedBuilder().setColor(danger ? 0xed4245 : 0x57f287).setTitle(danger ? `🚨 ${title}` : `✅ ${title}`).setDescription(desc).setTimestamp().setFooter({ text: "SaftyBot Protection" })] }); } catch { }
}
async function broadcastToSubscribers(client: Client, embed: EmbedBuilder) {
  let dmSent = 0, dmFailed = 0, channelSent = 0;
  for (const gid of Object.keys(db.subscriptions)) {
    const guild = client.guilds.cache.get(gid); if (!guild) continue;
    const oid = db.ownerIds[gid];
    if (oid) { try { await (await client.users.fetch(oid)).send({ embeds: [embed] }); dmSent++; } catch { dmFailed++; } }
    try { const sys = guild.systemChannel; if (sys) { await sys.send({ embeds: [embed] }); channelSent++; } } catch { }
  }
  return { dmSent, dmFailed, channelSent };
}
async function requireSub(i: ChatInputCommandInteraction): Promise<boolean> {
  if (i.user.id === BOT_OWNER_ID) return true;
  if (!i.guildId || !hasSubscription(i.guildId)) {
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🔒 Subscription Required").setDescription("This command requires an active subscription.\nUse `/subscribe` to activate full protection!")], ephemeral: true });
    return false;
  }
  return true;
}
async function requireBotOwner(i: ChatInputCommandInteraction): Promise<boolean> {
  if (i.user.id !== BOT_OWNER_ID) { await i.reply({ content: "❌ Only the bot owner can use this.", ephemeral: true }); return false; }
  return true;
}

async function sendSubscriptionRequest(client: Client, guildId: string, userId: string, guildName: string, userTag: string, userName: string) {
  if (!BOT_OWNER_ID) return;
  const key = `${guildId}_${userId}`;
  db.pendingSubscriptions[key] = { guildId, userId, guildName, userName, userTag, requestedAt: new Date().toISOString() };
  saveData(db);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`accept_sub_${guildId}_${userId}`).setLabel("✅ Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_sub_${guildId}_${userId}`).setLabel("❌ Decline").setStyle(ButtonStyle.Danger)
  );
  try {
    await (await client.users.fetch(BOT_OWNER_ID)).send({
      embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("💰 New Subscription Request!").addFields(
        { name: "👤 User", value: `**${userTag}** (<@${userId}>)`, inline: true },
        { name: "🌐 Server", value: `**${guildName}** (\`${guildId}\`)`, inline: true },
        { name: "💳 Payment", value: `Send **${PRICE_EGP} EGP / $${PRICE_USD} USD** via InstaPay to:\n\`${INSTAPAY_NUMBER}\`` }
      ).setTimestamp()], components: [row]
    });
  } catch (err) { logger.error({ err }, "Failed to DM bot owner"); }
}

async function handleSubscriptionButton(interaction: ButtonInteraction, client: Client) {
  if (interaction.user.id !== BOT_OWNER_ID) { await interaction.reply({ content: "❌ Only the bot owner can approve subscriptions.", ephemeral: true }); return; }
  const parts = interaction.customId.split("_");
  const action = parts[0], guildId = parts[2], userId = parts[3];
  if (!guildId || !userId) return;
  const key = `${guildId}_${userId}`;
  const pending = db.pendingSubscriptions[key];
  if (action === "accept") {
    const expiresAt = new Date(Date.now() + SUB_DURATION_DAYS * 86400000).toISOString();
    db.subscriptions[guildId] = { since: new Date().toISOString(), grantedBy: BOT_OWNER_ID, expiresAt };
    delete db.pendingSubscriptions[key]; saveData(db);
    await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Subscription Accepted").setDescription(`Server \`${guildId}\` activated until **${new Date(expiresAt).toLocaleDateString()}**`).setTimestamp()], components: [] });
    try { await (await client.users.fetch(userId)).send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🎉 Subscription Activated!").setDescription(`Your subscription for **${pending?.guildName ?? guildId}** is now active for **${SUB_DURATION_DAYS} days**!\n\nUse \`/status\` to confirm.`).setTimestamp()] }); } catch { }
  } else {
    delete db.pendingSubscriptions[key]; saveData(db);
    await interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Declined").setTimestamp()], components: [] });
    try { await (await client.users.fetch(userId)).send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Subscription Declined").setDescription(`Contact **${OWNER_CONTACT}** if you believe this is a mistake.`).setTimestamp()] }); } catch { }
  }
}

async function checkSubscriptionExpiry(client: Client) {
  const now = new Date();
  for (const [gid, sub] of Object.entries(db.subscriptions)) {
    const daysLeft = (new Date(sub.expiresAt).getTime() - now.getTime()) / 86400000;
    if (daysLeft <= 0) { delete db.subscriptions[gid]; saveData(db); await alertOwner(client, gid, "Subscription Expired", "Your SaftyBot subscription has expired. Use `/subscribe` to renew.", false); }
    else if (daysLeft <= 3 && !renewalNotified.has(gid)) { renewalNotified.add(gid); await alertOwner(client, gid, "Subscription Expiring Soon", `Expires in **${Math.ceil(daysLeft)} day(s)**. Use \`/subscribe\` to renew.`, false); }
  }
}

async function handlePing(i: ChatInputCommandInteraction) {
  const start = Date.now(); await i.deferReply();
  await i.editReply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🏓 Pong!").addFields({ name: "Bot Latency", value: `${Date.now() - start}ms`, inline: true }, { name: "API Latency", value: `${Math.round(i.client.ws.ping)}ms`, inline: true }, { name: "Status", value: "🟢 Online", inline: true }).setTimestamp()] });
}
async function handleHelp(i: ChatInputCommandInteraction) {
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📖 SaftyBot Commands").setDescription("**Public**\n`ping` `help` `features` `status` `subscribe` `invite` `uptime` `serverinfo` `userinfo` `avatar` `color` `8ball` `coinflip` `dice` `math` `remind` `afk` `poll` `report` `snipe` `editsnipe` `serverrank`\n\n**Admin Setup**\n`setowner` `setlogchannel` `setwelcome` `addword` `removeword` `wordlist` `antilink` `shield` `unshield` `shieldlist`\n\n**Moderation** *(subscription required)*\n`warn` `warnings` `clearwarns` `mute` `unmute` `kick` `ban` `tempban` `unban` `purge` `slowmode` `roleadd` `roleremove` `channellock` `channelunlock` `lockdown` `unlock` `scan` `masscheck`\n\n**Bot Owner**\n`addsubscription` `removesubscription` `listsubscriptions` `botinfo` `serverlist` `globalban` `blacklist` `unblacklist` `blacklistcheck` `dm` `news` `leak` `announce`").setFooter({ text: "Use /subscribe for full protection!" }).setTimestamp()] });
}
async function handleFeatures(i: ChatInputCommandInteraction) {
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("✨ SaftyBot Features").addFields({ name: "🛡️ Anti-Spam", value: "Auto-mutes spammers", inline: true }, { name: "💣 Anti-Nuke", value: "Detects mass deletions", inline: true }, { name: "🚪 Anti-Raid", value: "Alerts on rapid joins", inline: true }, { name: "🤖 Fake Accounts", value: "Auto-kicks new no-avatar accounts", inline: true }, { name: "🔗 Anti-Link", value: "Blocks Discord invite links", inline: true }, { name: "🗣️ Anti-Mention", value: "Stops mention spam", inline: true }, { name: "🤬 Word Filter", value: "Auto-deletes filtered words", inline: true }, { name: "🎉 Welcome Messages", value: "Custom welcome messages", inline: true }, { name: "💳 Price", value: `${PRICE_EGP} EGP / $${PRICE_USD} USD/month via InstaPay`, inline: false }).setFooter({ text: "Use /subscribe to activate!" }).setTimestamp()] });
}
async function handleStatus(i: ChatInputCommandInteraction) {
  if (!i.guildId) return;
  const active = hasSubscription(i.guildId), sub = db.subscriptions[i.guildId];
  await i.reply({ embeds: [new EmbedBuilder().setColor(active ? 0x57f287 : 0xed4245).setTitle(active ? "✅ Protection Active" : "❌ No Active Subscription").setDescription(active ? `Full protection active!\nExpires: **${new Date(sub.expiresAt).toLocaleDateString()}**` : "No active subscription.\nUse `/subscribe` to activate!").setTimestamp()] });
}
async function handleSubscribe(i: ChatInputCommandInteraction) {
  if (!i.guildId) return;
  if (hasSubscription(i.guildId)) { await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Already Subscribed").setDescription(`Expires: **${new Date(db.subscriptions[i.guildId].expiresAt).toLocaleDateString()}**`).setTimestamp()], ephemeral: true }); return; }
  await sendSubscriptionRequest(i.client, i.guildId, i.user.id, i.guild?.name ?? i.guildId, i.user.tag, i.user.username);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("💳 Request Sent!").setDescription(`Send **${PRICE_EGP} EGP / $${PRICE_USD} USD** via InstaPay to:\n\`${INSTAPAY_NUMBER}\`\n\nYou'll receive a DM once approved.`).setTimestamp()], ephemeral: true });
}
async function handleInvite(i: ChatInputCommandInteraction) {
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📨 Invite SaftyBot").setDescription(`[Click here to invite SaftyBot](https://discord.com/api/oauth2/authorize?client_id=${i.client.user?.id}&permissions=8&scope=bot+applications.commands)`).setTimestamp()] });
}
async function handleUptime(i: ChatInputCommandInteraction) {
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⏱️ Uptime").setDescription(`**${formatUptime(Date.now() - BOT_START_TIME)}**`).setTimestamp()] });
}
async function handleServerInfo(i: ChatInputCommandInteraction) {
  const g = i.guild; if (!g) return;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📊 ${g.name}`).addFields({ name: "ID", value: g.id, inline: true }, { name: "Owner", value: `<@${g.ownerId}>`, inline: true }, { name: "Members", value: `${g.memberCount}`, inline: true }, { name: "Channels", value: `${g.channels.cache.size}`, inline: true }, { name: "Roles", value: `${g.roles.cache.size}`, inline: true }, { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true }, { name: "Protection", value: hasSubscription(g.id) ? "✅ Active" : "❌ Inactive", inline: true }).setThumbnail(g.iconURL()).setTimestamp()] });
}
async function handleUserInfo(i: ChatInputCommandInteraction) {
  const target = i.options.getUser("user") ?? i.user, member = i.guild?.members.cache.get(target.id);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`👤 ${target.tag}`).addFields({ name: "ID", value: target.id, inline: true }, { name: "Bot", value: target.bot ? "Yes" : "No", inline: true }, { name: "Created", value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true }, { name: "Joined", value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Unknown", inline: true }, { name: "Warnings", value: `${db.warnings[i.guildId ?? ""]?.[target.id] ?? 0}`, inline: true }, { name: "Blacklisted", value: isBlacklisted(target.id) ? "⛔ Yes" : "✅ No", inline: true }).setThumbnail(target.displayAvatarURL()).setTimestamp()] });
}
async function handleAvatar(i: ChatInputCommandInteraction) {
  const t = i.options.getUser("user") ?? i.user;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🖼️ ${t.tag}'s Avatar`).setImage(t.displayAvatarURL({ size: 4096 })).setTimestamp()] });
}
async function handleColor(i: ChatInputCommandInteraction) {
  const hex = i.options.getString("hex", true).replace("#", ""), num = parseInt(hex, 16);
  if (isNaN(num)) { await i.reply({ content: "❌ Invalid hex color.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(num).setTitle(`🎨 #${hex.toUpperCase()}`).setDescription(`Hex: \`#${hex.toUpperCase()}\`\nDecimal: \`${num}\``).setTimestamp()] });
}
async function handle8Ball(i: ChatInputCommandInteraction) {
  const answers = ["✅ Yes", "❌ No", "🤔 Maybe", "🔮 Definitely", "🚫 Absolutely not", "💫 Signs point to yes", "🌑 Cannot predict now", "🎱 Ask again later", "✨ Without a doubt", "🌊 Very doubtful"];
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎱 Magic 8-Ball").addFields({ name: "Question", value: i.options.getString("question", true) }, { name: "Answer", value: answers[Math.floor(Math.random() * answers.length)] }).setTimestamp()] });
}
async function handleCoinFlip(i: ChatInputCommandInteraction) {
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🪙 Coin Flip").setDescription(`**${Math.random() < 0.5 ? "Heads" : "Tails"}**`).setTimestamp()] });
}
async function handleDice(i: ChatInputCommandInteraction) {
  const sides = i.options.getInteger("sides") ?? 6;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎲 Dice Roll").setDescription(`d${sides} → **${Math.floor(Math.random() * sides) + 1}**`).setTimestamp()] });
}
async function handleMath(i: ChatInputCommandInteraction) {
  const expr = i.options.getString("expression", true);
  try {
    const result = Function(`"use strict"; return (${expr.replace(/[^0-9+\-*/.() %]/g, "")})`)();
    await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🧮 Math").addFields({ name: "Expression", value: `\`${expr}\`` }, { name: "Result", value: `\`${result}\`` }).setTimestamp()] });
  } catch { await i.reply({ content: "❌ Invalid expression.", ephemeral: true }); }
}
async function handleRemind(i: ChatInputCommandInteraction) {
  const minutes = i.options.getInteger("minutes", true), msg = i.options.getString("message", true);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("⏰ Reminder Set").setDescription(`Reminding you in **${minutes}min**:\n> ${msg}`).setTimestamp()] });
  setTimeout(async () => { try { await i.user.send({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("⏰ Reminder!").setDescription(msg).setTimestamp()] }); } catch { } }, minutes * 60000);
}
async function handleAfk(i: ChatInputCommandInteraction) {
  const reason = i.options.getString("reason") ?? "AFK";
  db.afkUsers[i.user.id] = { reason, since: new Date().toISOString() }; saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("💤 AFK Set").setDescription(`You are now AFK: **${reason}**`).setTimestamp()] });
}
async function handlePoll(i: ChatInputCommandInteraction) {
  const question = i.options.getString("question", true);
  const options = [i.options.getString("option1", true), i.options.getString("option2", true), i.options.getString("option3"), i.options.getString("option4")].filter(Boolean) as string[];
  const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
  const msg = await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📊 ${question}`).setDescription(options.map((o, x) => `${emojis[x]} ${o}`).join("\n")).setFooter({ text: `Poll by ${i.user.tag}` }).setTimestamp()], fetchReply: true });
  for (let x = 0; x < options.length; x++) { try { await msg.react(emojis[x]); } catch { } }
}
async function handleReport(i: ChatInputCommandInteraction) {
  const target = i.options.getUser("user", true), reason = i.options.getString("reason", true);
  const ch = i.guild?.channels.cache.get(db.logChannels[i.guildId ?? ""]) as TextChannel;
  if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🚨 User Report").addFields({ name: "Reported", value: `${target.tag} (${target.id})` }, { name: "By", value: i.user.tag }, { name: "Reason", value: reason }).setTimestamp()] });
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Report Submitted").setTimestamp()], ephemeral: true });
}
async function handleSnipe(i: ChatInputCommandInteraction) {
  const snap = sniped.get(i.channelId);
  if (!snap) { await i.reply({ content: "Nothing to snipe here.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("👻 Sniped").setDescription(snap.content).setAuthor({ name: snap.author, iconURL: snap.avatar }).setFooter({ text: snap.at.toLocaleTimeString() }).setTimestamp()] });
}
async function handleEditSnipe(i: ChatInputCommandInteraction) {
  const snap = editSniped.get(i.channelId);
  if (!snap) { await i.reply({ content: "Nothing to snipe here.", ephemeral: true }); return; }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("✏️ Edit Sniped").addFields({ name: "Before", value: snap.before }, { name: "After", value: snap.after }).setAuthor({ name: snap.author }).setFooter({ text: snap.at.toLocaleTimeString() }).setTimestamp()] });
}
async function handleServerRank(i: ChatInputCommandInteraction) {
  if (!i.guildId) return;
  const gw = db.warnings[i.guildId] ?? {}, sorted = Object.entries(gw).sort((a, b) => b[1] - a[1]);
  const rank = sorted.findIndex(([uid]) => uid === i.user.id) + 1;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🏆 Warning Rank").addFields({ name: "Your Warnings", value: `${gw[i.user.id] ?? 0}`, inline: true }, { name: "Your Rank", value: rank > 0 ? `#${rank} of ${sorted.length}` : "Not ranked", inline: true }).setTimestamp()] });
}
async function handleWarn(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true), reason = i.options.getString("reason") ?? "No reason";
  if (!i.guildId) return;
  const count = addWarning(i.guildId, target.id);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("⚠️ User Warned").addFields({ name: "User", value: target.tag, inline: true }, { name: "Reason", value: reason, inline: true }, { name: "Total", value: `${count}`, inline: true }).setTimestamp()] });
  await logAction(i.client, i.guildId, "⚠️ Warning", `**${target.tag}** warned by **${i.user.tag}** — ${reason} (Total: ${count})`, 0xfee75c);
}
async function handleWarnings(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true); if (!i.guildId) return;
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("📋 Warnings").setDescription(`**${target.tag}** has **${db.warnings[i.guildId]?.[target.id] ?? 0}** warning(s).`).setTimestamp()] });
}
async function handleClearWarns(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true); if (!i.guildId) return;
  if (db.warnings[i.guildId]) delete db.warnings[i.guildId][target.id]; saveData(db);
  await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Warnings Cleared").setDescription(`Cleared for **${target.tag}**`).setTimestamp()] });
}
async function handleMute(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true), minutes = i.options.getInteger("minutes") ?? 10;
  const member = i.guild?.members.cache.get(target.id); if (!member) { await i.reply({ content: "❌ Member not found.", ephemeral: true }); return; }
  try { await member.timeout(minutes * 60000); await i.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔇 Muted").setDescription(`**${target.tag}** muted for **${minutes}min**`).setTimestamp()] }); if (i.guildId) await logAction(i.client, i.guildId, "🔇 Mute", `**${target.tag}** muted ${minutes}min by **${i.user.tag}**`, 0xed4245); }
  catch { await i.reply({ content: "❌ Could not mute.", ephemeral: true }); }
}
async function handleUnmute(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true), member = i.guild?.members.cache.get(target.id);
  if (!member) { await i.reply({ content: "❌ Member not found.", ephemeral: true }); return; }
  try { await member.timeout(null); await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🔊 Unmuted").setDescription(`**${target.tag}** unmuted.`).setTimestamp()] }); }
  catch { await i.reply({ content: "❌ Could not unmute.", ephemeral: true }); }
}
async function handleKick(i: ChatInputCommandInteraction) {
  if (!await requireSub(i)) return;
  const target = i.options.getUser("user", true), reason = i.options.getString("reason") ?? "No reason";
  const member = i.guild?.members.cache.get(target.id); if (!member) { await i.reply({ content: "❌ Member not found.", ephemeral: true }); return; }
  try { await member.kick(reason); await i **...**

_This response is too long to display in full._
