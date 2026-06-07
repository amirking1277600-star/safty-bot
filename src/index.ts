import { Client, GatewayIntentBits, Partials, Events } from "discord.js";
import { logger } from "./lib/logger"; 

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// هنا كنت حاطط الـ Logic بتاعك.. كمل عليه عادي
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // ده سطر "الحماية" اللي هيخلي البوت ميهنجش
    await interaction.deferReply({ ephemeral: false }).catch(() => {});

    // حط هنا الـ Logic بتاع الـ 50 أمر بتوعك زي ما كنت عاملهم بالظبط
    // مثال:
    if (interaction.commandName === 'ping') {
        await interaction.editReply("🏓 Pong!");
    }
});

client.login(process.env["DISCORD_TOKEN"]);
