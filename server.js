const express = require('express');
const socketIo = require('socket.io');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    socket.on('user-status', (data) => {
        console.log(`Статус от ${socket.id}:`, data);
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-status', data);
        }
    });

    socket.on('join-room', (roomId) => {
        socket.roomId = roomId;
        socket.join(roomId);

        if (!rooms.has(roomId)) {
            rooms.set(roomId, { users: [] });
        }

        const room = rooms.get(roomId);
        room.users.push(socket.id);

        console.log(`
