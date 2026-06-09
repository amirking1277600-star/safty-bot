import express from 'express';
const app = express();

app.get('/', (req, res) => {
    res.send('Bot is active');
});

export function keepAlive() {
    app.listen(3000, () => {
        console.log('Keep-alive server is running');
    });
}
