import {
  Client, GatewayIntentBits, REST, Routes, Events, SlashCommandBuilder, 
  ChatInputCommandInteraction, EmbedBuilder, TextChannel, ButtonBuilder, 
  ButtonStyle, ActionRowBuilder, ButtonInteraction, Partials
} from "discord.js";
import fs from "node:fs";
import path from "node:path";

// ─── Setup ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
let BOT_OWNER_ID: string;

// ضيف هنا المصفوفة الكبيرة بتاعة الأوامر اللي كانت عندك
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("🏓 Check bot latency"),
  new SlashCommandBuilder().setName("features").setDescription("✨ See bot features")
  // ... ضيف باقي أوامرك هنا بنفس الطريقة
].map(c => c.toJSON());

// ─── Command Handlers ──────────────────────────────────────────────────
(global as any).handlePing = async (i: ChatInputCommandInteraction) => {
    await i.reply({ content: `🏓 Pong! ${client.ws.ping}ms`, ephemeral: true });
};

(global as any).handleFeatures = async (i: ChatInputCommandInteraction) => {
    await i.reply({ content: '✨ SaftyBot is ready to protect your server!', ephemeral: true });
};

// ─── Event Handlers ────────────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
    BOT_OWNER_ID = c.user.id;
    console.log(`✅ SaftyBot is online! Logged in as ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN!);
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
});

client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand()) return;
    const handlerName = `handle${i.commandName.charAt(0).toUpperCase() + i.commandName.slice(1)}`;
    const handler = (global as any)[handlerName];
    if (typeof handler === 'function') {
        try { await handler(i); } catch (e) { console.error(e); }
    }
});

client.login(DISCORD_TOKEN);
