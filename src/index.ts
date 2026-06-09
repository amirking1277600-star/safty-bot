import { Client, GatewayIntentBits, Interaction } from 'discord.js';
import { keepAlive } from './lib/keep_alive.js'; 

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// Using a Map for efficient data storage
const channelSettings = new Map();
const messageCounters = new Map();

client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // Critical: Defer the reply to avoid "The application did not respond"
    await interaction.deferReply();

    if (interaction.commandName === 'setcount') {
        const count = interaction.options.getInteger('number');
        channelSettings.set(interaction.channelId, { count });
        await interaction.editReply(`Count updated to: ${count}`);
    } 
    // ... handle other commands
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const config = channelSettings.get(message.channelId);
    if (!config) return;

    let count = (messageCounters.get(message.channelId) || 0) + 1;
    
    if (count >= config.count) {
        await message.channel.send("Image triggered!");
        count = 0;
    }
    messageCounters.set(message.channelId, count);
});

keepAlive();
client.login(process.env.DISCORD_TOKEN);
