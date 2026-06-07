import pkg from "discord.js";
const { Client, GatewayIntentBits, Partials, Events, Collection } = pkg;
import { logger } from "./lib/logger.js"; // ده المسار الصح جوه src
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.Message]
});

(client as any).commands = new Collection();

// ده الجزء اللي بيقرأ الـ 50 أمر أوتوماتيك
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = await import(filePath);
    (client as any).commands.set(command.data.name, command);
}

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // ده عشان يفضل البوت "Alive" وما يقطعش الاتصال
    await interaction.deferReply({ ephemeral: false }).catch(() => {});

    const command = (client as any).commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        logger.error(error, "Error executing command");
        await interaction.editReply("❌ حصل مشكلة يا صاحبي، جرب تاني.").catch(() => {});
    }
});

client.login(process.env["DISCORD_TOKEN"]);
