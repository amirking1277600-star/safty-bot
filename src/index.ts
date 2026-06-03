import {
  Client, GatewayIntentBits, REST, Routes, Events, SlashCommandBuilder, 
  ChatInputCommandInteraction, EmbedBuilder, TextChannel, ButtonBuilder, 
  ButtonStyle, ActionRowBuilder, ButtonInteraction, PermissionFlagsBits
} from "discord.js";
import fs from "node:fs";
import path from "node:path";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("🏓 Check bot latency"),
  new SlashCommandBuilder().setName("features").setDescription("✨ See bot features")
].map(c => c.toJSON());

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ SaftyBot is online as ${c.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN!);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log('🚀 Commands registered!');
  } catch (e) { console.error(e); }
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;
  
  if (i.commandName === 'ping') {
    await i.reply({ content: `🏓 Pong! Latency is ${client.ws.ping}ms`, ephemeral: true });
  } else if (i.commandName === 'features') {
    await i.reply({ content: '✨ SaftyBot is ready to protect your server!', ephemeral: true });
  }
});

client.login(DISCORD_TOKEN);
