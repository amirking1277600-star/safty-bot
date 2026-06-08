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

client.once('ready', () => {
    console.log(`Logged in as ${client.user?.tag}!`);
});

client.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;

    if (message.content.toLowerCase() === '!post') {
        if (message.author.id !== ADMIN_ID) return;

        await message.delete().catch(() => {});

        const replyMsg = await message.channel.send("Check your DM!");
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);

        const dmChannel = await message.author.createDM();
        // استخدمنا as any عشان نتخطى مشكلة الـ Build اللي كانت بتقابلك
        await (dmChannel as any).send("Please send the image you want to post.");

        const filter = (m: Message) => m.author.id === message.author.id && m.attachments.size > 0;
        const collector = (dmChannel as any).createMessageCollector({ filter, max: 1, time: 60000 });

        collector.on('collect', async (m: any) => {
            const attachment = m.attachments.first();
            const targetChannel = client.channels.cache.get(TARGET_CHANNEL_ID) as TextChannel;

            if (targetChannel) {
                const messages = await targetChannel.messages.fetch({ limit: 100 });
                await targetChannel.bulkDelete(messages).catch(() => {});

                await targetChannel.send({
                    files: [attachment!.url]
                });
                
                await m.reply("The image has been posted successfully.");
            }
        });
    }
});

client.login(process.env.TOKEN);
