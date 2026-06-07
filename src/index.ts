const { Client, GatewayIntentBits, Partials, Events } = require("discord.js");

const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

client.once(Events.ClientReady, (c: any) => {
  console.log(`✅ Logged in as: ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction: any) => {
  if (!interaction.isChatInputCommand()) return;

  // ده الحل النهائي لـ The application did not respond
  try {
    await interaction.deferReply({ ephemeral: false });
  } catch (err) {
    console.error("Defer error:", err);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

if (!DISCORD_TOKEN) {
  console.error("❌ Error: DISCORD_TOKEN is missing!");
} else {
  client.login(DISCORD_TOKEN.trim()).catch((err: any) => {
    console.error("❌ Login failed:", err);
  });
}
