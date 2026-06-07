import { Client, GatewayIntentBits, Partials, Events, Interaction } from "discord.js";

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

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as: ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Fixes "The application did not respond" by deferring the reply
  await interaction.deferReply({ ephemeral: false }).catch(() => {});

  // Add your command execution logic here
  // Example:
  // if (interaction.commandName === 'ping') await interaction.editReply('Pong!');
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

if (!DISCORD_TOKEN) {
  console.error("❌ Error: DISCORD_TOKEN is missing!");
} else {
  client.login(DISCORD_TOKEN.trim()).catch((err) => {
    console.error("❌ Login failed:", err);
  });
}
