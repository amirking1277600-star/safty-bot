import { Client, GatewayIntentBits } from 'discord.js';
import { keepAlive } from './lib/keep_alive.js';

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const channelSettings = new Map<string, { count: number }>();
const messageCounters = new Map<string, number>();

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply();

    if (interaction.commandName === 'setcount') {
        const count = interaction.options.getInteger('number') || 10;
        channelSettings.set(interaction.channelId, { count });
        await interaction.editReply(`Count set to: ${count}`);
    } 
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const config = channelSettings.get(message.channelId);
    if (!config) return;

    const currentCount = (messageCounters.get(message.channelId) || 0) + 1;
    if (currentCount >= config.count) {
        await message.channel.send("Limit reached!");
        messageCounters.set(message.channelId, 0);
    } else {
        messageCounters.set(message.channelId, currentCount);
    }
});

keepAlive();
client.login(process.env.DISCORD_TOKEN);
