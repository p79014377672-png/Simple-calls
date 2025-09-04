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
const MAX_RECONNECT_ATTEMPTS = 3;

// Новые глобальные переменные для статуса собеседника
let remoteAudioMuted = false;
let remoteVideoOff = false;

// Защита от множественных нажатий
let isProcessingAudio = false;
let isProcessingVideo = false;

// КОНФИГУРАЦИЯ С TURN-СЕРВЕРОМ METERED
const configuration = {
    iceServers: [
        { urls: "stun:stun.relay.metered.ca:80" },
        { 
            urls: "turn:global.relay.metered.ca:80",
            username: "8080b533302c74fa69b0b1f3",
            credential: "n8y56B5MSDlWyUnU"
        },
        {
            urls: "turn:global.relay.metered.ca:80?transport=tcp",
            username: "8080b533302c74fa69b0b1f3",
            credential: "n8y56B5MSDlWyUnU"
        },
        {
            urls: "turn:global.relay.metered.ca:443",
            username: "8080b533302c74fa69b0b1f3",
            credential: "n8y56B5MSDlWyUnU"
        },
        {
            urls: "turns:global.relay.metered.ca:443?transport=tcp",
            username: "8080b533302c74fa69b0b1f3",
            credential: "n8y56B5MSDlWyUnU"
        }
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all'
};

async function init() {
    try {
        console.log('Инициализация началась...');
        
        // Проверка поддержки медиаустройств
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Ваш браузер не поддерживает доступ к камере и микрофону');
        }

        const urlParams = new URLSearchParams(window.location.search);
        roomId = urlParams.get('room') || generateRoomId();
        
        console.log('Комната:', roomId);
        
        if (!urlParams.has('room')) {
            const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
            window.history.replaceState({}, '', newUrl);
        }
        
        socket = io();
        console.log('Socket создан');
        
        // Сначала получаем медиапоток
        const mediaSuccess = await startLocalVideo();
        if (!mediaSuccess) {
            return; // Останавливаем если не удалось получить доступ к медиа
        }
        
        setupSocketEvents();
        socket.emit('join-room', roomId);
        console.log('Запрос на присоединение к комнате отправлен');
        
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showError('Ошибка при запуске: ' + error.message);
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
        
        if (!localStream || localStream.getTracks().length === 0) {
            throw new Error('Не удалось получить доступ к камере и микрофону');
        }
        
        videoTrack = localStream.getVideoTracks()[0];
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            localVideo.srcObject = localStream;
            // ЗЕРКАЛЬНОЕ ОТОБРАЖЕНИЕ ТОЛЬКО ДЛЯ ФРОНТАЛЬНОЙ КАМЕРЫ
            localVideo.style.transform = currentFacingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
        }
        
        console.log('Локальное видео запущено');
        return true;
    } catch (error) {
        console.error('Ошибка доступа к камере/микрофону:', error);
        showError('Не удалось получить доступ к камере и микрофону. Разрешите доступ и обновите страницу.');
        return false;
    }
}

async function switchCamera() {
    if (isProcessingVideo) return;
    
    isProcessingVideo = true;
    console.log('Переключение камеры...');
    
    try {
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
        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.style.transform = currentFacingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
        }
        
        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => 
                s.track && s.track.kind === 'video'
            );
            if (sender) await sender.replaceTrack(newVideoTrack);
        }
        
        // Останавливаем аудио треки из нового потока (мы используем старые)
        newStream.getAudioTracks().forEach(track => track.stop());
        
        console.log('Камера переключена на:', newFacingMode);
    } catch (error) {
        console.error('Ошибка при переключении камеры:', error);
        showMobileAlert('Ошибка переключения камеры');
    } finally {
        isProcessingVideo = false;
    }
}

// Новая система уведомлений
function updatePersistentNotifications() {
    const container = document.getElementById('persistentNotifications');
    if (!container) return;

    container.innerHTML = '';

    if (remoteAudioMuted) {
        const audioNotification = document.createElement('div');
        audioNotification.className = 'persistent-notification audio-muted';
        audioNotification.innerHTML = '🔇 Собеседник отключил микрофон';
        container.appendChild(audioNotification);
    }

    if (remoteVideoOff) {
        const videoNotification = document.createElement('div');
        videoNotification.className = 'persistent-notification video-off';
        videoNotification.innerHTML = '📹 Собеседник отключил камеру';
        container.appendChild(videoNotification);
    }
}

// Функция для временных уведомлений
function showTemporaryNotification(message, type) {
    const notifications = document.getElementById('statusNotifications');
    if (!notifications) return;
    
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

// Мобильные уведомления
function showMobileAlert(message) {
    const alertDiv = document.createElement('div');
    alertDiv.style = 'position:fixed; top:10px; left:10px; right:10px; background:rgba(0,0,0,0.8); color:white; padding:10px; z-index:1000; text-align:center; border-radius:5px;';
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);
    setTimeout(() => {
        if (alertDiv.parentNode) alertDiv.parentNode.removeChild(alertDiv);
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

function tryReconnect() {
    if (isReconnecting) return;
    
    isReconnecting = true;
    reconnectAttempts++;
    
    console.log(`Попытка переподключения #${reconnectAttempts}`);
    showMobileAlert('Переподключение...');
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        showReloadMessage();
        return;
    }
    
    if (socket && roomId) {
        socket.emit('join-room', roomId);
    }
    
    setTimeout(() => {
        isReconnecting = false;
    }, 2000);
}

function showReloadMessage() {
    document.body.innerHTML = `
        <div style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; flex-direction:column; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Не удалось восстановить связь</h2>
                <p>Попробуйте перезагрузить страницу</p>
                <button onclick="hardReload()" class="reload-button">
                    Обновить
                </button>
            </div>
        </div>
    `;
}

function updateInterface() {
    const audioButton = document.getElementById('toggleAudioButton');
    const videoButton = document.getElementById('toggleVideoButton');
    
    if (audioButton) {
        audioButton.textContent = isAudioMuted ? '🎤❌' : '🎤';
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
    
    updatePersistentNotifications();
}

function setupSocketEvents() {
    socket.on('you-are-the-first', () => {
        console.log('Вы первый в комнате. Ожидаем второго участника...');
        showMobileAlert('Ожидаем второго участника...');
    });
    
    socket.on('user-joined', async (data) => {
        console.log('Новый пользователь присоединился:', data.newUserId);
        showMobileAlert('Собеседник подключился!');
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
    
    socket.on('room-full', () => {
        console.error('Комната уже занята!');
        showError('В этой комнате уже есть два участника. Пожалуйста, создайте новую комнату.');
    });
    
    socket.on('user-status', (data) => {
        console.log('Получен статус от собеседника:', data);
        
        if (data && typeof data === 'object') {
            if (typeof data.audioMuted === 'boolean') {
                remoteAudioMuted = data.audioMuted;
            }
            if (typeof data.videoOff === 'boolean') {
                remoteVideoOff = data.videoOff;
            }
            updatePersistentNotifications();
        }
    });
    
    socket.on('user-left', (data) => {
        console.log('Пользователь вышел:', data.userId);
        showMobileAlert('Собеседник отключился');
        remoteAudioMuted = false;
        remoteVideoOff = false;
        updatePersistentNotifications();
        tryReconnect();
    });
    
    socket.on('disconnect', () => {
        console.log('Соединение с сервером разорвано');
        showMobileAlert('Соединение потеряно');
        tryReconnect();
    });
    
    socket.on('connect', () => {
        console.log('Соединение с сервером восстановлено');
        showMobileAlert('Соединение восстановлено');
        if (roomId) {
            socket.emit('join-room', roomId);
        }
    });
}

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
                showMobileAlert('Соединение установлено!');
                reconnectAttempts = 0;
                isReconnecting = false;
                break;
            case 'disconnected':
            case 'failed':
                console.log('Соединение разорвано или не удалось...');
                showMobileAlert('Потеря соединения');
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
            showMobileAlert('Ошибка соединения');
        }
    };

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        console.log('Получен удаленный поток');
        remoteStream = event.streams[0];
        
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo) {
            remoteVideo.srcObject = remoteStream;
        }
        
        reconnectAttempts = 0;
        showMobileAlert('Видео соединение установлено!');
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
            10000,
            'Таймаут при создании offer'
        );
        await waitWithTimeout(
            peerConnection.setLocalDescription(offer),
            5000,
            'Таймаут при установке local description'
        );
        socket.emit('offer', {
            targetUserId: targetUserId,
            offer: offer
        });
    } catch (error) {
        console.error('Ошибка создания offer:', error);
        showMobileAlert('Ошибка соединения');
    }
}

async function createAnswer(offer, targetUserId) {
    try {
        peerConnection = createPeerConnection(targetUserId);
        await waitWithTimeout(
            peerConnection.setRemoteDescription(new RTCSessionDescription(offer)),
            5000,
            'Таймаут при установке remote description (offer)'
        );
        const answer = await waitWithTimeout(
            peerConnection.createAnswer(),
            10000,
            'Таймаут при создании answer'
        );
        await waitWithTimeout(
            peerConnection.setLocalDescription(answer),
            5000,
            'Таймаут при установке local description (answer)'
        );
        socket.emit('answer', {
            targetUserId: targetUserId,
            answer: answer
        });
    } catch (error) {
        console.error('Ошибка создания answer:', error);
        showMobileAlert('Ошибка соединения');
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

async function toggleAudio() {
    if (isProcessingAudio) return;
    
    isProcessingAudio = true;
    console.log('Переключение аудио...');
    
    try {
        if (localStream) {
            const audioTracks = localStream.getAudioTracks();
            if (audioTracks.length > 0) {
                isAudioMuted = !isAudioMuted;
                audioTracks[0].enabled = !isAudioMuted;
                
                const button = document.getElementById('toggleAudioButton');
                if (button) {
                    button.textContent = isAudioMuted ? '🎤❌' : '🎤';
                    button.style.transform = 'scale(0.9)';
                    setTimeout(() => {
                        button.style.transform = 'scale(1)';
                    }, 150);
                }
                
                sendStatusToPeer();
                showMobileAlert(isAudioMuted ? 'Микрофон выключен' : 'Микрофон включен');
            }
        }
    } catch (error) {
        console.error('Ошибка переключения аудио:', error);
    } finally {
        setTimeout(() => {
            isProcessingAudio = false;
        }, 300);
    }
}

async function toggleVideo() {
    if (isProcessingVideo) return;
    
    isProcessingVideo = true;
    console.log('Переключение видео...');
    
    try {
        if (localStream) {
            const videoTracks = localStream.getVideoTracks();
            if (videoTracks.length > 0) {
                isVideoOff = !isVideoOff;
                videoTracks[0].enabled = !isVideoOff;
                
                const button = document.getElementById('toggleVideoButton');
                if (button) {
                    button.textContent = isVideoOff ? '🎥❌' : '🎥';
                    button.style.transform = 'scale(0.9)';
                    setTimeout(() => {
                        button.style.transform = 'scale(1)';
                    }, 150);
                }
                
                sendStatusToPeer();
                showMobileAlert(isVideoOff ? 'Камера выключена' : 'Камера включена');
            }
        }
    } catch (error) {
        console.error('Ошибка переключения видео:', error);
    } finally {
        setTimeout(() => {
            isProcessingVideo = false;
        }, 300);
    }
}

function showError(message) {
    if (document.querySelector('.error-container')) return;
    
    document.body.innerHTML = `
        <div class="error-container" style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Ошибка</h2>
                <p>${message}</p>
                <button onclick="hardReload()" class="reload-button">
                    Обновить
                </button>
            </div>
        </div>
    `;
}

function hardReload() {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = window.location.origin + window.location.pathname;
}

// Мобильная консоль для отладки
function showMobileAlert(message) {
    const alertDiv = document.createElement('div');
    alertDiv.style = 'position:fixed; top:10px; left:10px; right:10px; background:rgba(0,0,0,0.8); color:white; padding:10px; z-index:1000; text-align:center; border-radius:5px; font-size:14px;';
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);
    setTimeout(() => {
        if (alertDiv.parentNode) alertDiv.parentNode.removeChild(alertDiv);
    }, 3000);
}

document.addEventListener('DOMContentLoaded', init);
