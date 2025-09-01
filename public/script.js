// Глобальные переменные
let localStream = null;
let remoteStream = null;
let isAudioMuted = false;
let isVideoOff = false;
let peerConnection = null;
let socket = null;
let roomId = null;
let currentFacingMode = 'user';
let videoTrack = null;
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50;

// Новые глобальные переменные для статуса собеседника
let remoteAudioMuted = false;
let remoteVideoOff = false;

// Защита от множественных нажатий
let isProcessingAudio = false;
let isProcessingVideo = false;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.voipbuster.com:3478' },
        { urls: 'stun:stun.services.mozilla.com:3478' }
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all'
};

async function init() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        roomId = urlParams.get('room') || generateRoomId();
        
        if (!urlParams.has('room')) {
            const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
            window.history.replaceState({}, '', newUrl);
        }
        
        socket = io();
        await startLocalVideo();
        setupSocketEvents();
        socket.emit('join-room', roomId);
        
        // Правильная инициализация обработчиков после загрузки
        setTimeout(() => {
            const audioButton = document.getElementById('toggleAudioButton');
            const videoButton = document.getElementById('toggleVideoButton');
            const localVideo = document.getElementById('localVideo');
            
            if (audioButton) {
                audioButton.onclick = toggleAudio;
                audioButton._listenerAttached = true;
            }
            if (videoButton) {
                videoButton.onclick = toggleVideo;
                videoButton._listenerAttached = true;
            }
            if (localVideo) {
                localVideo.onclick = switchCamera;
            }
        }, 1000);
        
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showError('Ошибка при запуске приложения');
    }
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 10);
}

async function startLocalVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user' },
            audio: true 
        });
        videoTrack = localStream.getVideoTracks()[0];
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        // ПРИМЕНЯЕМ ЗЕРКАЛЬНОЕ ОТОБРАЖЕНИЕ
        localVideo.style.transform = 'scaleX(-1)';
    } catch (error) {
        console.error('Ошибка доступа к камере/микрофону:', error);
        showError('Не удалось получить доступ к камере и микрофону');
    }
}

async function switchCamera() {
    try {
        console.log('Переключение камеры...');
        if (videoTrack) videoTrack.stop();
        const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
        currentFacingMode = newFacingMode;
        const newStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: newFacingMode },
            audio: true 
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (localStream) {
            const oldVideoTrack = localStream.getVideoTracks()[0];
            localStream.removeTrack(oldVideoTrack);
            localStream.addTrack(newVideoTrack);
            videoTrack = newVideoTrack;
        }
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        // ПРИМЕНЯЕМ ЗЕРКАЛЬНОЕ ОТОБРАЖЕНИЕ
        localVideo.style.transform = 'scaleX(-1)';
        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => 
                s.track && s.track.kind === 'video'
            );
            if (sender) await sender.replaceTrack(newVideoTrack);
        }
        newStream.getAudioTracks().forEach(track => track.stop());
        console.log('Камера переключена на:', newFacingMode);
    } catch (error) {
        console.error('Ошибка при переключении камеры:', error);
    }
}

// Новая система уведомлений
function updatePersistentNotifications() {
    const container = document.getElementById('persistentNotifications');
    if (!container) return;

    // Очищаем контейнер
    container.innerHTML = '';

    // Создаем уведомление об аудио, если оно отключено у собеседника
    if (remoteAudioMuted) {
        const audioNotification = document.createElement('div');
        audioNotification.className = 'persistent-notification audio-muted';
        audioNotification.innerHTML = '🔇 Собеседник отключил микрофон';
        container.appendChild(audioNotification);
    }

    // Создаем уведомление о видео, если оно отключено у собеседника
    if (remoteVideoOff) {
        const videoNotification = document.createElement('div');
        videoNotification.className = 'persistent-notification video-off';
        videoNotification.innerHTML = '📹 Собеседник отключил камеру';
        container.appendChild(videoNotification);
    }
}

// Функция для временных уведомлений (для уведомлений о соединении)
function showTemporaryNotification(message, type) {
    const notifications = document.getElementById('statusNotifications');
    const notification = document.createElement('div');
    notification.className = `status-notification status-${type}`;
    notification.textContent = message;
    
    notifications.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

function sendStatusToPeer() {
    if (socket && roomId) {
        socket.emit('user-status', {
            audioMuted: isAudioMuted,
            videoOff: isVideoOff
        });
    }
}

function checkAndRestoreInterface() {
    // Эта функция теперь нужна только для крайних случаев
    if (document.querySelector('.video-container') === null) {
        console.log('Полное восстановление интерфейса...');
        restoreInterface();
    }
}

function tryReconnect() {
    if (isReconnecting) return;
    
    isReconnecting = true;
    reconnectAttempts++;
    
    console.log(`Попытка переподключения #${reconnectAttempts}`);
    showReconnectingMessage();
    
    if (reconnectAttempts >= 2) {
        console.log('Автоматическая перезагрузка после 2 попыток...');
        setTimeout(() => {
            window.location.reload(true);
        }, 1000);
        return;
    }
    
    if (socket && roomId) {
        socket.emit('join-room', roomId);
    }
    
    setTimeout(() => {
        isReconnecting = false;
    }, 2000);
}

function showReconnectingMessage() {
    document.body.innerHTML = `
        <div style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; flex-direction:column; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Связь прервалась</h2>
                <p>Пытаюсь восстановить соединение...</p>
                <button onclick="window.location.reload(true)" class="reload-button">
                    Обновить
                </button>
            </div>
        </div>
    `;
}

function showReloadMessage() {
    document.body.innerHTML = `
        <div style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; flex-direction:column; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Не удалось восстановить связь</h2>
                <p>Попробуйте перезагрузить страницу</p>
                <button onclick="window.location.reload(true)" class="reload-button">
                    Обновить
                </button>
            </div>
        </div>
    `;
}

// Функция для обновления интерфейса без пересоздания
function updateInterface() {
    // ТОЛЬКО обновляем состояние кнопок
    const audioButton = document.getElementById('toggleAudioButton');
    const videoButton = document.getElementById('toggleVideoButton');
    
    if (audioButton) {
        audioButton.textContent = isAudioMuted ? '🎤❌' : '🎤';
        // Важно: не перепривязываем обработчики, если они уже есть
        if (!audioButton._listenerAttached) {
            audioButton.onclick = toggleAudio;
            audioButton._listenerAttached = true;
        }
    }
    
    if (videoButton) {
        videoButton.textContent = isVideoOff ? '🎥❌' : '🎥';
        if (!videoButton._listenerAttached) {
            videoButton.onclick = toggleVideo;
            videoButton._listenerAttached = true;
        }
    }
    
    // Обновляем постоянные уведомления
    updatePersistentNotifications();
}

// Функция для полного восстановления интерфейса
function restoreInterface() {
    if (document.querySelector('.video-container')) {
        return; // Интерфейс уже существует
    }
    
    document.body.innerHTML = `
        <div class="video-container">
            <video id="remoteVideo" autoplay playsinline></video>
            <video id="localVideo" autoplay muted playsinline></video>
            
            <div id="persistentNotifications" class="persistent-notifications"></div>
            
            <div class="controls">
                <button id="toggleAudioButton" class="control-button">🎤</button>
                <button id="toggleVideoButton" class="control-button">🎥</button>
            </div>
            
            <div id="statusNotifications" class="status-notifications"></div>
        </div>
    `;
    
    // Восстанавливаем видео потоки
    if (localStream) {
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        // ВОССТАНАВЛИВАЕМ ЗЕРКАЛЬНОЕ ОТОБРАЖЕНИЕ
        localVideo.style.transform = 'scaleX(-1)';
    }
    if (remoteStream) {
        document.getElementById('remoteVideo').srcObject = remoteStream;
    }
    
    // Привязываем обработчики и помечаем их как привязанные
    const audioButton = document.getElementById('toggleAudioButton');
    const videoButton = document.getElementById('toggleVideoButton');
    const localVideo = document.getElementById('localVideo');
    
    if (audioButton) {
        audioButton.onclick = toggleAudio;
        audioButton._listenerAttached = true;
        audioButton.textContent = isAudioMuted ? '🎤❌' : '🎤';
    }
    
    if (videoButton) {
        videoButton.onclick = toggleVideo;
        videoButton._listenerAttached = true;
        videoButton.textContent = isVideoOff ? '🎥❌' : '🎥';
    }
    
    if (localVideo) {
        localVideo.onclick = switchCamera;
    }
    
    updatePersistentNotifications();
}

function setupSocketEvents() {
    socket.on('you-are-the-first', () => {
        console.log('Вы первый в комнате. Ожидаем второго участника...');
    });
    
    socket.on('user-joined', async (data) => {
        console.log('Новый пользователь присоединился:', data.newUserId);
        reconnectAttempts = 0;
        await createOffer(data.newUserId);
    });
    
    socket.on('offer', async (data) => {
        console.log('Получен offer от:', data.from);
        await createAnswer(data.offer, data.from);
    });
    
    socket.on('answer', async (data) => {
        console.log('Получен answer от:', data.from);
        await setRemoteAnswer(data.answer);
    });
    
    socket.on('ice-candidate', async (data) => {
        console.log('Получен ICE candidate от:', data.from);
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
            console.error('Ошибка добавления ICE candidate:', error);
        }
    });
    
    // Обработчик для переполненной комнаты
    socket.on('room-full', () => {
        console.error('Комната уже занята!');
        showError('В этой комнате уже есть два участника. Пожалуйста, создайте новую комнату.');
    });
    
    // ОБРАБОТЧИК СТАТУСОВ (БЕЗ ВРЕМЕННЫХ УВЕДОМЛЕНИЙ)
    socket.on('user-status', (data) => {
        console.log('Получен статус от собеседника:', data);
        
        // Сохраняем статус собеседника в глобальных переменных
        if (data.hasOwnProperty('audioMuted')) {
            remoteAudioMuted = data.audioMuted;
        }
        
        if (data.hasOwnProperty('videoOff')) {
            remoteVideoOff = data.videoOff;
        }
        
        // Обновляем только постоянные уведомления (БЕЗ временных уведомлений)
        updatePersistentNotifications();
    });
    
    socket.on('user-left', (data) => {
        console.log('Пользователь вышел:', data.userId);
        // Сбрасываем статус собеседника при выходе
        remoteAudioMuted = false;
        remoteVideoOff = false;
        updatePersistentNotifications();
        tryReconnect();
    });
    
    socket.on('disconnect', () => {
        console.log('Соединение с сервером разорвано');
        tryReconnect();
    });
    
    socket.on('connect', () => {
        console.log('Соединение с сервером восстановлено');
        if (roomId) {
            socket.emit('join-room', roomId);
        }
    });
}

// Функция: Таймаут для операций WebRTC
function waitWithTimeout(promise, timeoutMs, errorMessage) {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        )
    ]);
}

function createPeerConnection(targetUserId) {
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        console.log('Состояние PeerConnection:', state);
        switch(state) {
            case 'connected':
                showTemporaryNotification('Соединение установлено', 'connected');
                reconnectAttempts = 0;
                isReconnecting = false;
                break;
            case 'disconnected':
            case 'failed':
                console.log('Соединение разорвано или не удалось...');
                break;
            case 'closed':
                console.log('Соединение полностью закрыто');
                break;
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        console.log('ICE состояние:', state);
        if (state === 'failed') {
            console.error('ICE Gathering завершилось ошибкой. Возможно, проблемы с сетью.');
        }
        if (state === 'disconnected') {
            console.log('ICE соединение разорвано (возможно, временные проблемы с сетью).');
        }
    };

    peerConnection.onicegatheringstatechange = () => {
        console.log('ICE Gathering состояние:', peerConnection.iceGatheringState);
    };

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        console.log('Получен удаленный поток');
        remoteStream = event.streams[0];
        
        // Устанавливаем видео поток ТОЛЬКО если элемент существует и поток еще не установлен
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo && !remoteVideo.srcObject) {
            remoteVideo.srcObject = remoteStream;
        }
        
        reconnectAttempts = 0;
        
        // Просто обновляем интерфейс (кнопки, уведомления)
        updateInterface();
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                targetUserId: targetUserId,
                candidate: event.candidate
            });
        }
    };

    return peerConnection;
}

async function createOffer(targetUserId) {
    try {
        peerConnection = createPeerConnection(targetUserId);
        const offer = await waitWithTimeout(
            peerConnection.createOffer(),
