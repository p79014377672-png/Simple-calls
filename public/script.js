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
        roomId = window.location.hash.substring(1) || generateRoomId();
        if (!window.location.hash) {
            window.location.hash = roomId;
        }
        socket = io();
        await startLocalVideo();
        setupSocketEvents();
        socket.emit('join-room', roomId);
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
        alert('Не удалось переключить камеру');
    }
}

function setupSocketEvents() {
    socket.on('you-are-the-first', () => {
        console.log('Вы первый в комнате. Ожидаем второго участника...');
    });
    socket.on('user-joined', async (data) => {
        console.log('Новый пользователь присоединился:', data.newUserId);
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
    socket.on('user-left', (data) => {
        console.log('Пользователь вышел:', data.userId);
        simpleHangup();
    });
}

function createPeerConnection(targetUserId) {
    peerConnection = new RTCPeerConnection(configuration);
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    peerConnection.ontrack = (event) => {
        console.log('Получен удаленный поток');
        remoteStream = event.streams[0];
        document.getElementById('remoteVideo').srcObject = remoteStream;
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
    }
}

async function setRemoteAnswer(answer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
        console.error('Ошибка установки remote description:', error);
    }
}

// ПРОИЗВЕЛИ ЗАМЕНУ ТЕКСТА И КНОПКИ
function simpleHangup() {
    console.log('Завершение звонка');
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (remoteStream) remoteStream.getTracks().forEach(track => track.stop());
    if (videoTrack) videoTrack.stop();
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    document.getElementById('localVideo').srcObject = null;
    document.getElementById('remoteVideo').srcObject = null;
    document.body.innerHTML = `
        <div style="width:100%; height:100%; background-color:black; color:white; 
                   display:flex; justify-content:center; align-items:center; 
                   font-family:sans-serif; text-align:center; padding:20px;">
            <div>
                <h2>Связь прервалась</h2>
                <p>Попробуйте восстановить соединение</p>
                <button onclick="window.location.reload()" 
                        style="padding:10px 20px; background-color:#4CAF50; color:white; 
                               border:none; border-radius:5px; cursor:pointer; margin:5px;">
                    Восстановить
                </button>
            </div>
        </div>
    `;
}

function hangUp() {
    simpleHangup();
}

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

document.addEventListener('DOMContentLoaded', init);
