import { Client, GatewayIntentBits, Partials, Events, Interaction } from "discord.js";

// استيراد الـ Client وكل الـ Functions اللي إنت كاتبها (لازم تتأكد إنك مصدّرها من ملف الكود بتاعك)
// بفرض إن الكود بتاعك اسمه bot.ts
import { client, handleSubscriptionButton } from "./bot.js"; 

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as: ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  // 1. التعامل مع الأزرار (Subscription System)
  if (interaction.isButton()) {
    await handleSubscriptionButton(interaction as any, client);
    return;
  }

  // 2. التعامل مع الأوامر (Slash Commands)
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply({ ephemeral: false }).catch(() => {});

  try {
    // هنا بنشغل الـ Functions اللي إنت كاتبها بناءً على اسم الأمر
    switch (interaction.commandName) {
      case 'ping':
        await handlePing(interaction as any);
        break;
      case 'features':
        await handleFeatures(interaction as any);
        break;
      case 'help':
        await handleHelp(interaction as any);
        break;
      // ضيف باقي الـ 50 أمر بنفس الطريقة، أو استدعيها من ملفات تانية
      default:
        await interaction.editReply("🛠️ This command is registered but the handler is not linked yet.");
    }
  } catch (err) {
    console.error("Execution error:", err);
    await interaction.editReply("❌ Error executing command.").catch(() => {});
  }
});

client.login(process.env["DISCORD_TOKEN"]);
