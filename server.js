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

// Хранилище для комнат и заблокированных комнат
const rooms = new Map();
const blockedRooms = new Map();

// Функция проверки и очистки устаревших блокировок
function cleanupBlockedRooms() {
    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    
    for (const [roomId, blockTime] of blockedRooms.entries()) {
        if (now - blockTime > threeDays) {
            blockedRooms.delete(roomId);
            console.log(`Комната ${roomId} разблокирована после 3 дней`);
        }
    }
}

setInterval(cleanupBlockedRooms, 6 * 60 * 60 * 1000);

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    socket.on('join-room', (roomId) => {
        if (blockedRooms.has(roomId)) {
            console.log(`Попытка подключения к заблокированной комнате: ${roomId}`);
            socket.emit('room-blocked');
            return;
        }

        socket.roomId = roomId;
        socket.join(roomId);

        if (!rooms.has(roomId)) {
            rooms.set(roomId, { users: [] });
        }

        const room = rooms.get(roomId);
        room.users.push(socket.id);

        console.log(`Пользователь ${socket.id} присоединился к комнате ${roomId}`);
        console.log(`В комнате ${roomId} теперь пользователей: ${room.users.length}`);

        if (room.users.length > 1) {
            socket.to(roomId).emit('user-joined', { newUserId: socket.id });
        } else {
            socket.emit('you-are-the-first');
        }
    });

    socket.on('offer', (data) => {
        console.log(`Offer от ${socket.id} для ${data.targetUserId}`);
        socket.to(data.targetUserId).emit('offer', {
            offer: data.offer,
            from: socket.id
        });
    });

    socket.on('answer', (data) => {
        console.log(`Answer от ${socket.id} для ${data.targetUserId}`);
        socket.to(data.targetUserId).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        console.log(`ICE candidate от ${socket.id}`);
        socket.to(data.targetUserId).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on('force-hangup', (roomId) => {
        console.log(`Принудительное завершение звонка в комнате: ${roomId}`);
        
        blockedRooms.set(roomId, Date.now());
        console.log(`Комната ${roomId} заблокирована на 3 дня`);
        
        socket.to(roomId).emit('call-force-ended');
        
        const room = rooms.get(roomId);
        if (room) {
            room.users.forEach(userId => {
                const userSocket = io.sockets.sockets.get(userId);
                if (userSocket) {
                    userSocket.disconnect(true);
                }
            });
            rooms.delete(roomId);
        }
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);

        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            if (room) {
                room.users = room.users.filter(id => id !== socket.id);
                console.log(`Пользователь ${socket.id} удален из комнаты ${socket.roomId}`);

                if (room.users.length === 0) {
                    rooms.delete(socket.roomId);
                    console.log(`Комната ${socket.roomId} удалена`);
                } else {
                    socket.to(socket.roomId).emit('user-left', { userId: socket.id });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
