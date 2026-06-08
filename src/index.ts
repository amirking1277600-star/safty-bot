import { Client, GatewayIntentBits, Interaction, TextChannel } from 'discord.js';

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'post') {
        // الرد في الخاص
        await interaction.reply({ content: "📥 Please send the image in DM.", ephemeral: true });
        
        const dmChannel = await interaction.user.createDM();
        const filter = (m: any) => m.author.id === interaction.user.id && m.attachments.size > 0;
        const collector = dmChannel.createMessageCollector({ filter, max: 1, time: 60000 });

        collector.on('collect', async (m) => {
            const attachment = m.attachments.first();
            const channel = client.channels.cache.get('YOUR_CHANNEL_ID') as TextChannel;
            
            if (channel) {
                // مسح كل شيء في الروم قبل النشر
                const messages = await channel.messages.fetch({ limit: 100 });
                await channel.bulkDelete(messages);
                
                await channel.send({ content: "📢 **New Update:**", files: [attachment!.url] });
                await m.reply("✅ Success!");
            }
        });
    }
});

client.login(process.env.TOKEN);
