// Глобальные переменные
let localStream = null;
let remoteStream = null;
let isAudioMuted = false;
let isVideoOff = false;
let peerConnection = null;
let socket = null;
let roomId = null;
let currentFacingMode = 'user'; // 'user' (фронтальная) или 'environment' (задняя)
let videoTrack = null;

// Конфигурация STUN-серверов
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Инициализация при загрузке страницы
async function init() {
    try {
        // Генерируем уникальный ID комнаты
        roomId = window.location.hash.substring(1) || generateRoomId();
        
        // Если комнаты не было в URL, устанавливаем ее в hash
        if (!window.location.hash) {
            window.location.hash = roomId;
        }
        
        // Подключаемся к серверу Socket.io
        socket = io();
        
        // Запускаем нашу камеру
        await startLocalVideo();
        
        // Настраиваем обработчики событий Socket.io
        setupSocketEvents();
        
        // Присоединяемся к комнате
        socket.emit('join-room', roomId);
        
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showError('Ошибка при запуске приложения');
    }
}

// Генерация случайного ID комнаты
function generateRoomId() {
    return Math.random().toString(36).substring(2, 10);
}

// Запуск нашей локальной камеры
async function startLocalVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user' }, // начинаем с фронтальной камеры
            audio: true 
        });
        
        // Сохраняем видео-трек для дальнейшего использования
        videoTrack = localStream.getVideoTracks()[0];
        document.getElementById('localVideo').srcObject = localStream;
        
    } catch (error) {
        console.error('Ошибка доступа к камере/микрофону:', error);
        showError('Не удалось получить доступ к камере и микрофону. Разрешите доступ и перезагрузите страницу.');
    }
}

// НОВАЯ ФУНКЦИЯ: Переключение между камерами
async function switchCamera() {
    try {
        console.log('Переключение камеры...');
        
        // Останавливаем текущий видео-трек
        if (videoTrack) {
            videoTrack.stop();
        }
        
        // Определяем какую камеру включить (переключаем)
        const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
        currentFacingMode = newFacingMode;
        
        // Получаем новое медиа с выбранной камерой
        const newStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: newFacingMode },
            audio: true 
        });
        
        // Получаем новый видео-трек
        const newVideoTrack = newStream.getVideoTracks()[0];
        
        // Заменяем видео-трек в существующем stream
        if (localStream) {
            const oldVideoTrack = localStream.getVideoTracks()[0];
            localStream.removeTrack(oldVideoTrack);
            localStream.addTrack(newVideoTrack);
            videoTrack = newVideoTrack;
        }
        
        // Обновляем отображение
        document.getElementById('localVideo').srcObject = localStream;
        
        // Если есть активное соединение, заменяем трек
        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => 
                s.track && s.track.kind === 'video'
            );
            if (sender) {
                await sender.replaceTrack(newVideoTrack);
            }
        }
        
        // Останавливаем ненужные аудио-треки из нового stream
        newStream.getAudioTracks().forEach(track => track.stop());
        
        console.log('Камера переключена на:', newFacingMode);
        
    } catch (error) {
        console.error('Ошибка при переключении камеры:', error);
        alert('Не удалось переключить камеру. Возможно, эта функция не поддерживается вашим устройством.');
    }
}

// Настройка обработчиков событий Socket.io
function setupSocketEvents() {
    // 1. Мы первые в комнате - ждем второго участника
    socket.on('you-are-the-first', () => {
        console.log('Вы первый в комнате. Ожидаем второго участника...');
    });

    // 2. В комнату присоединился новый пользователь - создаем offer
    socket.on('user-joined', async (data) => {
        console.log('Новый пользователь присоединился:', data.newUserId);
        await createOffer(data.newUserId);
    });

    // 3. Получили offer - создаем answer
    socket.on('offer', async (data) => {
        console.log('Получен offer от:', data.from);
        await createAnswer(data.offer, data.from);
    });

    // 4. Получили answer - устанавливаем удаленное описание
    socket.on('answer', async (data) => {
        console.log('Получен answer от:', data.from);
        await setRemoteAnswer(data.answer);
    });

    // 5. Получили ICE-кандидат - добавляем его
    socket.on('ice-candidate', async (data) => {
        console.log('Получен ICE candidate от:', data.from);
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
            console.error('Ошибка добавления ICE candidate:', error);
        }
    });

    // 6. Пользователь вышел из комнаты
    socket.on('user-left', (data) => {
        console.log('Пользователь вышел:', data.userId);
        simpleHangup();
    });
}

// Создание PeerConnection
function createPeerConnection(targetUserId) {
    peerConnection = new RTCPeerConnection(configuration);

    // Добавляем наши треки в PeerConnection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Обработчик получения удаленных треков
    peerConnection.ontrack = (event) => {
        console.log('Получен удаленный поток');
        remoteStream = event.streams[0];
        document.getElementById('remoteVideo').srcObject = remoteStream;
    };

    // Генерация ICE-кандидатов
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Отправляем ICE candidate');
            socket.emit('ice-candidate', {
                targetUserId: targetUserId,
                candidate: event.candidate
            });
        }
    };

    return peerConnection;
}

// Создание и отправка offer
async function createOffer(targetUserId) {
    try {
        peerConnection = createPeerConnection(targetUserId);
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('offer', {
            targetUserId: targetUserId,
            offer: offer
        });
        
        console.log('Offer создан и отправлен');
    } catch (error) {
        console.error('Ошибка создания offer:', error);
    }
}

// Создание и отправка answer
async function createAnswer(offer, targetUserId) {
    try {
        peerConnection = createPeerConnection(targetUserId);
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.emit('answer', {
            targetUserId: targetUserId,
            answer: answer
        });
        
        console.log('Answer создан и отправлен');
    } catch (error) {
        console.error('Ошибка создания answer:', error);
    }
}

// Установка удаленного answer
async function setRemoteAnswer(answer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Remote description установлен');
    } catch (error) {
        console.error('Ошибка установки remote description:', error);
    }
}

// Простое завершение звонка
function simpleHangup() {
    console.log('Завершение звонка');
    
    // Останавливаем все медиапотоки
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
    }
    
    // Останавливаем отдельно видео-трек
    if (videoTrack) {
        videoTrack.stop();
    }

    // Закрываем PeerConnection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Очищаем видео элементы
    document.getElementById('localVideo').srcObject = null;
    document.getElementById('remoteVideo').srcObject = null;

    // Показываем сообщение о завершении
    document.body.innerHTML = `
        <div style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Звонок завершен</h2>
                <button onclick="window.location.reload()" 
                        style="padding:10px 20px; background-color:#4CAF50; color:white; 
                               border:none; border-radius:5px; cursor:pointer; margin:5px;">
                    Начать новый звонок
                </button>
            </div>
        </div>
    `;
}

// Завершение звонка
function hangUp() {
    simpleHangup();
}

// Переключение аудио
function toggleAudio() {
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length > 0) {
            isAudioMuted = !isAudioMuted;
            audioTracks[0].enabled = !isAudioMuted;
            document.getElementById('toggleAudioButton').textContent = isAudioMuted ? '🎤❌' : '🎤';
        }
    }
}

// Переключение видео
function toggleVideo() {
    if (localStream) {
        const videoTracks = localStream.getVideoTracks();
        if (videoTracks.length > 0) {
            isVideoOff = !isVideoOff;
            videoTracks[0].enabled = !isVideoOff;
            document.getElementById('toggleVideoButton').textContent = isVideoOff ? '🎥❌' : '🎥';
        }
    }
}

// Показать сообщение об ошибке
function showError(message) {
    document.body.innerHTML = `
        <div style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Ошибка</h2>
                <p>${message}</p>
                <button onclick="window.location.reload()" 
                        style="padding:10px 20px; background-color:#f44336; color:white; 
                               border:none; border-radius:5px; cursor:pointer;">
                    Попробовать снова
                </button>
            </div>
        </div>
    `;
}

// Запускаем инициализацию когда страница загрузится
document.addEventListener('DOMContentLoaded', init);
