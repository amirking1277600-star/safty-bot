import { Client, GatewayIntentBits } from 'discord.js';
import { keepAlive } from './lib/keep_alive';

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const channelSettings = new Map();
const messageCounters = new Map();

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply();

    if (interaction.commandName === 'setcount') {
        const count = interaction.options.getInteger('number');
        channelSettings.set(interaction.channelId, { count });
        await interaction.editReply(`Count set to: ${count}`);
    } 
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const config = channelSettings.get(message.channelId);
    if (!config) return;

    const count = (messageCounters.get(message.channelId) || 0) + 1;
    if (count >= config.count) {
        await message.channel.send("Message limit reached!");
        messageCounters.set(message.channelId, 0);
    } else {
        messageCounters.set(message.channelId, count);
    }
});

keepAlive();
client.login(process.env.DISCORD_TOKEN);
