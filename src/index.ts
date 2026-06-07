import { Client, GatewayIntentBits, Partials, Events, Interaction as DiscordInteraction } from "discord.js";

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

client.on(Events.InteractionCreate, async (interaction: DiscordInteraction) => {
  if (!interaction.isChatInputCommand()) return;

  // Defer reply to prevent "The application did not respond" error
  await interaction.deferReply({ ephemeral: false }).catch(() => {});
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
