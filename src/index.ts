import { Client, GatewayIntentBits } from 'discord.js';
import { keepAlive } from './keep_alive.js'; // Note the .js extension

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

let channelSettings = {}; 
let messageCounters = {};

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply({ ephemeral: false });

    if (interaction.commandName === 'setcount') {
        const count = interaction.options.getInteger('number');
        channelSettings[interaction.channelId] = { ...channelSettings[interaction.channelId], count };
        await interaction.editReply(`Count set to: ${count}`);
    } 
    else if (interaction.commandName === 'setimage') {
        const image = interaction.options.getString('url') || interaction.options.getAttachment('file').url;
        channelSettings[interaction.channelId] = { ...channelSettings[interaction.channelId], image };
        await interaction.editReply(`Image saved successfully!`);
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const config = channelSettings[message.channelId];
    if (!config || !config.count) return;

    messageCounters[message.channelId] = (messageCounters[message.channelId] || 0) + 1;

    if (messageCounters[message.channelId] >= config.count) {
        await message.channel.send({ content: "Here is your image:", files: [config.image] });
        messageCounters[message.channelId] = 0;
    }
});

keepAlive();

client.login(process.env.DISCORD_TOKEN);
