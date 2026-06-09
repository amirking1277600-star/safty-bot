import express from 'express';
const app = express();

app.get('/', (req, res) => {
    res.send('Bot is active and running 24/7');
});

export function keepAlive() {
    app.listen(3000, () => {
        console.log('Keep-alive server is running on port 3000');
    });
}