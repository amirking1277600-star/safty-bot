import {
  Client, GatewayIntentBits, REST, Routes, Events, SlashCommandBuilder, 
  ChatInputCommandInteraction, EmbedBuilder, TextChannel, ButtonBuilder, 
  ButtonStyle, ActionRowBuilder, ButtonInteraction, Partials
} from "discord.js";
import fs from "node:fs";
import path from "node:path";

// تعريف الـ client هنا هو اللي بيحل مشكلة الـ ReferenceError
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});
