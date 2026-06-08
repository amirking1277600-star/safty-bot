if (command === 'post') {
    // 1. يبعتلك في الخاص
    const dmChannel = await message.author.createDM();
    await dmChannel.send("📥 **Admin Mode:** Please send the image or file you wish to post.");

    // 2. يستنى الرد
    const filter = (m: Message) => m.author.id === message.author.id && m.attachments.size > 0;
    const collector = dmChannel.createMessageCollector({ filter, max: 1, time: 60000 });

    collector.on('collect', async (m) => {
        const attachment = m.attachments.first();
        
        // 3. يبعتها في الروم المحددة
        const targetChannel = client.channels.cache.get('1512125669482565702') as TextChannel;
        if (targetChannel) {
            await targetChannel.send({
                content: "📢 **New Post:**",
                files: [attachment!.url]
            });
            // 4. تأكيد النشر في الخاص
            await m.reply("✅ **Success:** Your file has been posted successfully.");
        }
    });
}
