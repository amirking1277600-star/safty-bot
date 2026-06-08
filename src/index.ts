if (command === 'post') {
    const dmChannel = await message.author.createDM();
    await dmChannel.send("📥 **Admin Mode:** Please send the image or file you wish to post.");

    const filter = (m: Message) => m.author.id === message.author.id && m.attachments.size > 0;
    const collector = dmChannel.createMessageCollector({ filter, max: 1, time: 60000 });

    collector.on('collect', async (m) => {
        const attachment = m.attachments.first();
        const targetChannel = client.channels.cache.get('1512125669482565702') as TextChannel;
        
        if (targetChannel) {
            await targetChannel.send({
                content: "📢 **New Update:**",
                files: [attachment!.url]
            });
            await m.reply("✅ **Success:** The file has been posted successfully.");
        } else {
            await m.reply("❌ **Error:** Could not find the target channel.");
        }
    });

    collector.on('end', (collected) => {
        if (collected.size === 0) {
            dmChannel.send("⏳ **Timeout:** No file was provided. Operation cancelled.");
        }
    });
}
