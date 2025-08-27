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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Хранилище для комнат и заблокированных комнат
const rooms = new Map();
const blockedRooms = new Map(); // roomId -> timestamp блокировки

// Функция проверки и очистки устаревших блокировок
function cleanupBlockedRooms() {
    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000; // 3 дня в миллисекундах
    
    for (const [roomId, blockTime] of blockedRooms.entries()) {
        if (now - blockTime > threeDays) {
            blockedRooms.delete(roomId);
            console.log(`Комната ${roomId} разблокирована после 3 дней`);
        }
    }
}

// Запускаем очистку каждые 6 часов
setInterval(cleanupBlockedRooms, 6 * 60 * 60 * 1000);

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    // 1. Обработка присоединения к комнате
    socket.on('join-room', (roomId) => {
        // Проверяем, не заблокирована ли комната
        if (blockedRooms.has(roomId)) {
            console.log(`Попытка подключения к заблокированной комнате: ${roomId}`);
            socket.emit('room-blocked');
            return;
        }

        // Сохраняем, в какой комнате находится пользователь
        socket.roomId = roomId;
        socket.join(roomId);

        // Инициализируем комнату, если её нет
        if (!rooms.has(roomId)) {
            rooms.set(roomId, { users: [] });
        }

        const room = rooms.get(roomId);
        room.users.push(socket.id);

        console.log(`Пользователь ${socket.id} присоединился к комнате ${roomId}`);
        console.log(`В комнате ${roomId} теперь пользователей: ${room.users.length}`);

        // Если в комнате уже есть кто-то (>1 пользователя), сообщаем всем о новом участнике
        if (room.users.length > 1) {
            // Сообщаем всем в комнате (кроме нового пользователя), что нужно подготовить offer
            socket.to(roomId).emit('user-joined', { newUserId: socket.id });
        } else {
            // Если пользователь первый в комнате, говорим ему сгенерировать offer
            socket.emit('you-are-the-first');
        }
    });

    // 2. Пересылка WebRTC offer
    socket.on('offer', (data) => {
        console.log(`Offer от ${socket.id} для ${data.targetUserId}`);
        socket.to(data.targetUserId).emit('offer', {
            offer: data.offer,
            from: socket.id
        });
    });

    // 3. Пересылка WebRTC answer
    socket.on('answer', (data) => {
        console.log(`Answer от ${socket.id} для ${data.targetUserId}`);
        socket.to(data.targetUserId).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    // 4. Пересылка ICE-кандидатов
    socket.on('ice-candidate', (data) => {
        console.log(`ICE candidate от ${socket.id}`);
        socket.to(data.targetUserId).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    // 5. Обработка принудительного завершения звонка
    socket.on('force-hangup', (roomId) => {
        console.log(`Принудительное завершение звонка в комнате: ${roomId}`);
        
        // Блокируем комнату на 3 дня
        blockedRooms.set(roomId, Date.now());
        console.log(`Комната ${roomId} заблокирована на 3 дня`);
        
        // Сообщаем всем в комнате о завершении
        socket.to(roomId).emit('call-force-ended');
        
        // Закрываем все соединения в комнате
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

    // 6. Обработка отключения пользователя
    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);

        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            if (room) {
                // Удаляем пользователя из комнаты
                room.users = room.users.filter(id => id !== socket.id);
                console.log(`Пользователь ${socket.id} удален из комнаты ${socket.roomId}`);

                // Если комната пустая, удаляем её
                if (room.users.length === 0) {
                    rooms.delete(socket.roomId);
                    console.log(`Комната ${socket.roomId} удалена`);
                } else {
                    // Сообщаем оставшимся пользователям, что кто-то вышел
                    socket.to(socket.roomId).emit('user-left', { userId: socket.id });
                }
            }
        }
    });
});

const HTTPS_PORT = process.env.HTTPS_PORT || 3000;
server.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`HTTPS сервер запущен на порту ${HTTPS_PORT}`);
    console.log(`Откройте: https://localhost:${HTTPS_PORT}`);
});
