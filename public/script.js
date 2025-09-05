//Глобальные переменные let localStream= null; let remoteStream= null; let isAudioMuted= false; let isVideoOff= false; let peerConnection= null; let socket= null; let roomId= null; let currentFacingMode= 'user'; let videoTrack= null; let isReconnecting= false; let reconnectAttempts= 0; const MAX_RECONNECT_ATTEMPTS= 3;

// Новые глобальные переменные для статуса собеседника let remoteAudioMuted= false; let remoteVideoOff= false;

// Защита от множественных нажатий let isProcessingAudio= false; let isProcessingVideo= false;

// КОНФИГУРАЦИЯ С TURN-СЕРВЕРОМ METERED const configuration= { iceServers: [
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
    ], iceCandidatePoolSize: 10, iceTransportPolicy: 'all' };

async function init() { try { console.log('Инициализация началась...');

}

function setupControlButtons() { const shareButton = document.getElementById('shareButton'); if (shareButton) { shareButton.onclick = shareRoomLink; shareButton._listenerAttached = true; } }

function generateRoomId() { return Math.random().toString(36).substring(2, 10); }

async function startLocalVideo() { try { localStream = await navigator.mediaDevices.getUserMedia({  video: { facingMode: 'user' }, audio: true  });

}

async function switchCamera() { if (isProcessingVideo) return;

}

// Новая система уведомлений function updatePersistentNotifications(){ const container = document.getElementById('persistentNotifications'); if (!container) return;

}

// Функция для временных уведомлений (оставляем только уникальные) function showTemporaryNotification(message,type) { // Убираем дублирующиеся сообщения const duplicateMessages = [
        'Соединение установлено',
        'Собеседник подключился!',
        'Переподключение...',
        'Соединение восстановлено'
    ];

}

// Мобильные уведомления (ПЕРЕМЕЩЕНЫ ВНИЗ ЭКРАНА) function showMobileAlert(message){ // Удаляем предыдущие уведомления const existingAlerts = document.querySelectorAll('.mobile-alert'); existingAlerts.forEach(alert => alert.remove());

}

function shareRoomLink() { const roomLink = ${window.location.origin}${window.location.pathname}?room=${roomId};

}

function copyToClipboard(text) { const textarea = document.createElement('textarea'); textarea.value = text; document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); document.body.removeChild(textarea); showMobileAlert('Ссылка скопирована в буфер'); }

function sendStatusToPeer() { if (socket && roomId) { socket.emit('user-status', { audioMuted: isAudioMuted, videoOff: isVideoOff }); } }

function tryReconnect() { if (isReconnecting) return;

}

function showReloadMessage() { document.body.innerHTML = 
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
    ; }

function updateInterface() { const audioButton = document.getElementById('toggleAudioButton'); const videoButton = document.getElementById('toggleVideoButton');

}

function setupSocketEvents() { socket.on('you-are-the-first', () => { console.log('Вы первый в комнате. Ожидаем второго участника...'); showMobileAlert('Ожидаем второго участника...'); });

}

function waitWithTimeout(promise, timeoutMs, errorMessage) { return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        )
    ]); }

function createPeerConnection(targetUserId) { peerConnection = new RTCPeerConnection(configuration);

}

async function createOffer(targetUserId) { try { peerConnection = createPeerConnection(targetUserId); const offer = await waitWithTimeout( peerConnection.createOffer(), 10000, 'Таймаут при создании offer' ); await waitWithTimeout( peerConnection.setLocalDescription(offer), 5000, 'Таймаут при установке local description' ); socket.emit('offer', { targetUserId: targetUserId, offer: offer }); } catch (error) { console.error('Ошибка создания offer:', error); showMobileAlert('Ошибка соединения'); } }

async function createAnswer(offer, targetUserId) { try { peerConnection = createPeerConnection(targetUserId); await waitWithTimeout( peerConnection.setRemoteDescription(new RTCSessionDescription(offer)), 5000, 'Таймаут при установке remote description (offer)' ); const answer = await waitWithTimeout( peerConnection.createAnswer(), 10000, 'Таймаут при создании answer' ); await waitWithTimeout( peerConnection.setLocalDescription(answer), 5000, 'Таймаут при установке local description (answer)' ); socket.emit('answer', { targetUserId: targetUserId, answer: answer }); } catch (error) { console.error('Ошибка создания answer:', error); showMobileAlert('Ошибка соединения'); } }

async function setRemoteAnswer(answer) { try { await peerConnection.setRemoteDescription(new RTCSessionDescription(answer)); } catch (error) { console.error('Ошибка установки remote description:', error); tryReconnect(); } }

async function toggleAudio() { if (isProcessingAudio) return;

}

async function toggleVideo() { if (isProcessingVideo) return;

}

function showError(message) { if (document.querySelector('.error-container')) return;

}

function hardReload() { localStorage.clear(); sessionStorage.clear(); window.location.href = window.location.origin + window.location.pathname; }

document.addEventListener('DOMContentLoaded', init); [file content end]


