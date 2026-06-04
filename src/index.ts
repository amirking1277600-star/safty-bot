import {
  Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder,
  ChatInputCommandInteraction, EmbedBuilder, Events, PermissionFlagsBits,
  TextChannel, ButtonBuilder, ButtonStyle, ActionRowBuilder, ButtonInteraction,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";

// تعريف الـ client لازم يكون هنا في البداية
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// دلوقتي كمل باقي الكود بتاعك (الدوال والـ commands)...

