import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent 
    ] 
});

client.once('ready', () => {
    console.log(`Log: SAFTY BOT is online and ready! Logged in as ${client.user?.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
