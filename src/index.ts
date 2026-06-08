import { Client, GatewayIntentBits, Message, TextChannel } from 'discord.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const TARGET_CHANNEL_ID = '1512125669482565702';
const ADMIN_ID = '1409336978243063908';

client.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;

    if (message.content.toLowerCase() === '!post') {
        if (message.author.id !== ADMIN_ID) return;

        const channel = message.channel as TextChannel;
        try {
            const fetched = await channel.messages.fetch({ limit: 100 });
            await channel.bulkDelete(fetched);
        } catch (error) {
            console.error(error);
        }

        const dmChannel = await message.author.createDM();
        await dmChannel.send("📥 Please send the image or file.");

        const filter = (m: Message) => m.author.id === message.author.id && m.attachments.size > 0;
        const collector = dmChannel.createMessageCollector({ filter, max: 1, time: 60000 });

        collector.on('collect', async (m) => {
            const attachment = m.attachments.first();
            const targetChannel = client.channels.cache.get(TARGET_CHANNEL_ID) as TextChannel;
            
            if (targetChannel) {
                await targetChannel.send({
                    content: "📢 **New Update:**",
                    files: [attachment!.url]
                });
                await m.reply("✅ **Success:** The file has been posted.");
            }
        });
    }
});

client.login(process.env.TOKEN);
