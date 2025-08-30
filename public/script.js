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

// УЛУЧШЕННАЯ конфигурация STUN-серверов
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

// Инициализация при загрузке страницы
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
        
        // Запускаем периодическую проверку интерфейса
        setInterval(checkAndRestoreInterface, 1000);
        
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
        document.getElementById('localVideo').srcObject = localStream;
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
        document.getElementById('localVideo').srcObject = localStream;
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

// НОВАЯ ФУНКЦИЯ: Показать уведомление о статусе
function showStatusNotification(message, type) {
    const notifications = document.getElementById('statusNotifications');
    const notification = document.createElement('div');
    notification.className = `status-notification status-${type}`;
    notification.textContent = message;
    
    notifications.appendChild(notification);
    
    // Автоматически скрываем через 5 секунд
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 5000);
}

// НОВАЯ ФУНКЦИЯ: Отправить статус аудио/видео собеседнику
function sendStatusToPeer() {
    if (socket && roomId) {
        socket.emit('user-status', {
            audioMuted: isAudioMuted,
            videoOff: isVideoOff
        });
    }
}

// НОВАЯ ФУНКЦИЯ: Проверка и восстановление интерфейса
function checkAndRestoreInterface() {
    if (remoteStream && document.querySelector('.video-container') === null) {
        console.log('Восстанавливаем интерфейс после подключения...');
        restoreInterface();
    }
}

// НОВАЯ ФУНКЦИЯ: Автоматическое переподключение
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

// НОВАЯ ФУНКЦИЯ: Показать сообщение о переподключении
function showReconnectingMessage() {
    document.body.innerHTML = `
        <div style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Связь прервалась</h2>
                <p>Пытаюсь восстановить соединение...</p>
            </div>
        </div>
    `;
}

// НОВАЯ ФУНКЦИЯ: Показать сообщение о необходимости перезагрузки
function showReloadMessage() {
    document.body.innerHTML = `
        <div style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Не удалось восстановить связь</h2>
                <p>Попробуйте перезагрузить страницу</p>
                <button onclick="window.location.reload(true)" 
                        style="padding:10px 20px; background-color:#4CAF50; color:white; 
                               border:none; border-radius:5px; cursor:pointer; margin:5px;">
                    Перезагрузить
                </button>
            </div>
        </div>
    `;
}

// НОВАЯ ФУНКЦИЯ: Восстановление нормального интерфейса
function restoreInterface() {
    document.body.innerHTML = `
        <div class="video-container">
            <video id="remoteVideo" autoplay playsinline></video>
            <video id="localVideo" autoplay muted playsinline></video>
            <div class="controls">
                <button id="toggleAudioButton" class="control-button">🎤</button>
                <button id="toggleVideoButton" class="control-button">🎥</button>
            </div>
            <div id="statusNotifications" class="status-notifications"></div>
        </div>
    `;
    
    if (localStream) {
        document.getElementById('localVideo').srcObject = localStream;
    }
    if (remoteStream) {
        document.getElementById('remoteVideo').srcObject = remoteStream;
    }
    
    // Перепривязываем обработчики событий
    document.getElementById('toggleAudioButton').onclick = toggleAudio;
    document.getElementById('toggleVideoButton').onclick = toggleVideo;
    document.getElementById('localVideo').onclick = switchCamera;
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
    
    // НОВЫЙ ОБРАБОТЧИК: Получение статуса от собеседника
    socket.on('user-status', (data) => {
        console.log('Получен статус от собеседника:', data);
        
        if (data.audioMuted) {
            showStatusNotification('Собеседник отключил микрофон', 'audio-muted');
        }
        
        if (data.videoOff) {
            showStatusNotification('Собеседник отключил камеру', 'video-off');
        }
    });
    
    socket.on('user-left', (data) => {
        console.log('Пользователь вышел:', data.userId);
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

function createPeerConnection(targetUserId) {
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onconnectionstatechange = () => {
        console.log('Состояние соединения:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' || 
            peerConnection.connectionState === 'failed') {
            console.log('Соединение разорвано, пытаемся восстановить...');
            tryReconnect();
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE состояние:', peerConnection.iceConnectionState);
    };

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        console.log('Получен удаленный поток');
        remoteStream = event.streams[0];
        document.getElementById('remoteVideo').srcObject = remoteStream;
        reconnectAttempts = 0;
        
        checkAndRestoreInterface();
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
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', {
            targetUserId: targetUserId,
            offer: offer
        });
    } catch (error) {
        console.error('Ошибка создания offer:', error);
        tryReconnect();
    }
}

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
    } catch (error) {
        console.error('Ошибка создания answer:', error);
        tryReconnect();
    }
}

async function setRemoteAnswer(answer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
        console.error('Ошибка установки remote description:', error);
        tryReconnect();
    }
}

function toggleAudio() {
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length > 0) {
            isAudioMuted = !isAudioMuted;
            audioTracks[0].enabled = !isAudioMuted;
            document.getElementById('toggleAudioButton').textContent = isAudioMuted ? '🎤❌' : '🎤';
            
            // Отправляем статус собеседнику
            sendStatusToPeer();
            
            // Показываем уведомление себе
            if (isAudioMuted) {
                showStatusNotification('Вы отключили микрофон', 'audio-muted');
            }
        }
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTracks = localStream.getVideoTracks();
        if (videoTracks.length > 0) {
            isVideoOff = !isVideoOff;
            videoTracks[0].enabled = !isVideoOff;
            document.getElementById('toggleVideoButton').textContent = isVideoOff ? '🎥❌' : '🎥';
            
            // Отправляем статус собеседнику
            sendStatusToPeer();
            
            // Показываем уведомление себе
            if (isVideoOff) {
                showStatusNotification('Вы отключили камеру', 'video-off');
            }
        }
    }
}

function showError(message) {
    document.body.innerHTML = `
        <div style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Ошибка</h2>
                <p>${message}</p>
            </div>
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', init);
