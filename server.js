const express = require('express');
const socketIo = require('socket.io');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

// КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: Явно указываем CORS политику
const io = socketIo(server, {
    cors: {
        origin: "*", // Разрешаем запросы с любого origin
        methods: ["GET", "POST"]
    }
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle all other routes by serving index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();

function leaveRoom(socket) {
    if (socket.roomId) {
        const room = rooms.get(socket.roomId);
        if (room) {
            room.users = room.users.filter(id => id !== socket.id);
            console.log(`Пользователь ${socket.id} удален из комнаты ${socket.roomId}. Осталось: ${room.users.length}`);
            
            socket.to(socket.roomId).emit('user-left', { userId: socket.id });

            if (room.users.length === 0) {
                rooms.delete(socket.roomId);
                console.log(`Комната ${socket.roomId} удалена (пустая)`);
            }
        }
        socket.roomId = null;
    }
}

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    socket.on('user-status', (data) => {
        console.log(`Статус от ${socket.id}:`, data);
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-status', data);
        }
    });

    socket.on('join-room', (roomId) => {
        console.log(`Пользователь ${socket.id} запросил комнату ${roomId}`);
        
        if (socket.roomId) {
            console.log(`Пользователь ${socket.id} уже в комнате ${socket.roomId}. Выходим...`);
            leaveRoom(socket);
        }

        if (!rooms.has(roomId)) {
            rooms.set(roomId, { users: [] });
            console.log(`Комната ${roomId} создана`);
        }

        const room = rooms.get(roomId);
        
        if (room.users.length >= 2) {
            console.log(`Комната ${roomId} переполнена. Отклоняем подключение ${socket.id}`);
            socket.emit('room-full');
            return;
        }
        
        socket.roomId = roomId;
        socket.join(roomId);
        room.users.push(socket.id);
        
        console.log(`Пользователь ${socket.id} присоединился к комнате ${roomId}`);
        console.log(`В комнате ${roomId} теперь пользователей: ${room.users.length}`);

        if (room.users.length === 1) {
            socket.emit('you-are-the-first');
        } else if (room.users.length === 2) {
            const firstUserSocket = io.sockets.sockets.get(room.users[0]);
            if (firstUserSocket) {
                firstUserSocket.emit('user-joined', { newUserId: socket.id });
            }
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
        console.log(`ICE candidate от ${socket.id} для ${data.targetUserId}`);
        socket.to(data.targetUserId).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
        leaveRoom(socket);
    });
});

// КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: Render теперь использует порт 10000
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
