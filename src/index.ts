// ─── Client Initialization ─────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ─── Final Startup & Handler Registration ──────────────────────────────
client.once(Events.ClientReady, async (c) => {
    BOT_OWNER_ID = c.user.id;
    console.log(`✅ SaftyBot is online! Logged in as ${c.user.tag}`);
    
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN!);
    try {
        await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
        console.log('🚀 Commands registered successfully!');
    } catch (error) {
        console.error('❌ Failed to register commands:', error);
    }

    setInterval(() => checkSubscriptionExpiry(client), 60 * 60 * 1000);
});

client.on(Events.InteractionCreate, async (i) => {
    if (i.isButton()) return handleSubscriptionButton(i, client);
    if (!i.isChatInputCommand()) return;

    const cmdName = i.commandName;
    const handlerName = `handle${cmdName.charAt(0).toUpperCase() + cmdName.slice(1)}`;
    const handler = (global as any)[handlerName];

    if (typeof handler === 'function') {
        try {
            await handler(i);
        } catch (error) {
            console.error(`Error executing ${cmdName}:`, error);
            if (!i.replied && !i.deferred) {
                await i.reply({ content: '❌ An error occurred.', ephemeral: true });
            }
        }
    } else {
        await i.reply({ content: '⚠️ This command is under development.', ephemeral: true });
    }
});

client.login(DISCORD_TOKEN);

