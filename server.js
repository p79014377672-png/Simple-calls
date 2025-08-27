const express = require('express');
const socketIo = require('socket.io');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();

// Читаем SSL-сертификаты
const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, 'ssl', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
};

// Создаем HTTPS-сервер
const server = https.createServer(sslOptions, app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Обслуживаем статические файлы
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обрабатываем все GET-запросы
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ... остальной код (сокеты, комнаты) остается без изменений ...

const HTTPS_PORT = process.env.PORT || 3000; // Render сам подставит порт
server.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${HTTPS_PORT}`);
});
