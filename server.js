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

app.get('*', (req, res, next) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map(); // roomId -> { users: [socketId1, socketId2] }

// Вспомогательная функция для корректного выхода из комнаты
function leaveRoom(socket) {
    if (socket.roomId) {
        const room = rooms.get(socket.roomId);
        if (room) {
            // Удаляем пользователя из списка комнаты
            room.users = room.users.filter(id => id !== socket.id);
            console.log(`Пользователь ${socket.id} удален из комнаты ${socket.roomId}. Осталось: ${room.users.length}`);
            
            // Оповещаем всех ОСТАВШИХСЯ в комнате, что пользователь вышел
            socket.to(socket.roomId).emit('user-left', { userId: socket.id });

            // Если комната пустая, удаляем её
            if (room.users.length === 0) {
                rooms.delete(socket.roomId);
                console.log(`Комната ${socket.roomId} удалена (пустая)`);
            }
        }
        // Обнуляем roomId у сокета
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
        
        // Если пользователь уже был в какой-то комнате, выходим из неё
        if (socket.roomId) {
            console.log(`Пользователь ${socket.id} уже в комнате ${socket.roomId}. Выходим...`);
            leaveRoom(socket);
        }

        // Создаем комнату, если её нет
        if (!rooms.has(roomId)) {
            rooms.set(roomId, { users: [] });
            console.log(`Комната ${roomId} создана`);
        }

        const room = rooms.get(roomId);
        
        // Проверяем лимит (макс. 2 пользователя)
        if (room.users.length >= 2) {
            console.log(`Комната ${roomId} переполнена. Отклоняем подключение ${socket.id}`);
            socket.emit('room-full'); // Отправляем событие на клиент
            return; // НЕ добавляем пользователя в комнату
        }
        
        // Если есть место, добавляем пользователя
        socket.roomId = roomId;
        socket.join(roomId);
        room.users.push(socket.id);
        
        console.log(`Пользователь ${socket.id} присоединился к комнате ${roomId}`);
        console.log(`В комнате ${roomId} теперь пользователей: ${room.users.length}`);

        // Отправляем события в зависимости от количества пользователей
        if (room.users.length === 1) {
            socket.emit('you-are-the-first');
        } else if (room.users.length === 2) {
            // Оповещаем ПЕРВОГО участника, что присоединился ВТОРОЙ
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
        leaveRoom(socket); // Вызываем функцию выхода из комнаты
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
