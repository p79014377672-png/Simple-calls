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

// Функция для временных уведомлений (ОСТАЕТСЯ для уведомлений о соединении)
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
        document.getElementById('localVideo').srcObject = localStream;
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
                showTemporaryNotification('Соединение установлено', 'connected'); // ОСТАЕТСЯ
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
        showTemporaryNotification('Ошибка соединения. Попробуйте обновить страницу.', 'error'); // ОСТАЕТСЯ
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
        showTemporaryNotification('Ошибка соединения. Попробуйте обновить страницу.', 'error'); // ОСТАЕТСЯ
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

// ФУНКЦИЯ toggleAudio (БЕЗ ВРЕМЕННЫХ УВЕДОМЛЕНИЙ)
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
                button.textContent = isAudioMuted ? '🎤❌' : '🎤';
                
                button.style.transform = 'scale(0.9)';
                setTimeout(() => {
                    button.style.transform = 'scale(1)';
                }, 150);
                
                sendStatusToPeer();
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

// ФУНКЦИЯ toggleVideo (БЕЗ ВРЕМЕННЫХ УВЕДОМЛЕНИЙ)
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
                button.textContent = isVideoOff ? '🎥❌' : '🎥';
                
                button.style.transform = 'scale(0.9)';
                setTimeout(() => {
                    button.style.transform = 'scale(1)';
                }, 150);
                
                sendStatusToPeer();
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
    document.body.innerHTML = `
        <div style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Ошибка</h2>
                <p>${message}</p>
                <button onclick="window.location.reload(true)" class="reload-button">
                    Обновить
                </button>
            </div>
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', init);
