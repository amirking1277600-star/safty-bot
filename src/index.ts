import { Client, GatewayIntentBits, Partials, Events } from "discord.js";

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

client.on(Events.InteractionCreate, async (interaction) => {
  // دي أهم خطوة: لو مش ChatInput (أمر) اخرج فوراً
  if (!interaction.isChatInputCommand()) return;

  // 1. دي اللي بتوقف رسالة الـ "is thinking..." وتعرف ديسكورد إننا بنحضر الرد
  await interaction.deferReply({ ephemeral: false }).catch(() => {});

  try {
    // 2. هنا الـ Logic بتاعك: بدل ما نكتب كل أمر، هنعمل Switch عشان يغطي الكل
    switch (interaction.commandName) {
      case 'subscribe':
        await interaction.editReply('✅ Subscribed successfully!');
        break;
      case 'features':
        await interaction.editReply('✨ Current features: Auto-Mod, Welcome, and more!');
        break;
      // ضيف هنا أي أمر تاني عندك، مثلاً:
      // case 'ping':
      //   await interaction.editReply('Pong!');
      //   break;
      default:
        await interaction.editReply('❓ This command is not implemented yet.');
        break;
    }
  } catch (err) {
    console.error("Execution error:", err);
    await interaction.editReply('❌ Error executing this command.').catch(() => {});
  }
});

if (!DISCORD_TOKEN) {
  console.error("❌ Error: DISCORD_TOKEN is missing!");
} else {
  client.login(DISCORD_TOKEN.trim()).catch((err) => {
    console.error("❌ Login failed:", err);
  });
}
