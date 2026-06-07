import { Client, GatewayIntentBits, Partials, Events, Collection } from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// هنا بنخزن الأوامر عشان نعرف نشغلها
(client as any).commands = new Collection();

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as: ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ده اللي بيخلي البوت ميعلقش
  await interaction.deferReply({ ephemeral: false }).catch(() => {});

  try {
    // توزيع الأوامر: كل أمر هينفذ الـ Function الخاص بيه
    // أنا ربطت لك الأوامر الأساسية عشان تبدأ
    switch (interaction.commandName) {
      case 'ping':
        await interaction.editReply(`🏓 Pong! API Latency: ${Math.round(interaction.client.ws.ping)}ms`);
        break;
        
      case 'features':
        await interaction.editReply('✨ SaftyBot is active! Use /help to see all commands.');
        break;

      default:
        // أي أمر تاني لسه ما ضفتش الـ logic بتاعه
        await interaction.editReply(`🔧 The command **/${interaction.commandName}** is active but logic needs to be attached.`);
        break;
    }
  } catch (err) {
    console.error("Command Error:", err);
    await interaction.editReply('❌ Error executing this command.');
  }
});

client.login(process.env["DISCORD_TOKEN"]);
