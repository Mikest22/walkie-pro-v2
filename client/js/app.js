import { AudioManager } from './audio.js';
import { SignalingClient } from './signaling.js';
import { WebRTCManager } from './webrtc.js';
import { PTTManager } from './ptt.js';
import { generateRoomCode, getDeviceId, getRoomFromUrl } from './rooms.js';
import { Diagnostics } from './diagnostics.js';

const $ = (s)=> document.querySelector(s);
const screenStart = $('#screen-start');
const screenRadio = $('#screen-radio');
const inputName = $('#input-name');
const inputRoom = $('#input-room');
const btnCreate = $('#btn-create');
const btnJoin = $('#btn-join');
const btnRandom = $('#btn-random');
const shareBox = $('#share-box');
const shareLink = $('#share-link');
const btnCopy = $('#btn-copy');
const startError = $('#start-error');
const diagMini = $('#diag-mini');

const roomLabel = $('#room-label');
const connDot = $('#conn-dot');
const connText = $('#conn-text');
const iceLabel = $('#ice-label');
const modeLabel = $('#mode-label');
const channelState = $('#channel-state');
const speakerName = $('#speaker-name');
const usersList = $('#users-list');
const usersCount = $('#users-count');
const btnPtt = $('#btn-ptt');
const pttLabel = $('#ptt-label');
const pttIcon = $('#ptt-icon');
const vol = $('#vol');
const btnLeave = $('#btn-leave');
const btnMute = $('#btn-mute');
const btnDiag = $('#btn-diag');
const modalDiag = $('#modal-diag');
const diagBody = $('#diag-body');
const btnCloseDiag = $('#btn-close-diag');
const btnTest = $('#btn-test');
const btnRestartIce = $('#btn-restart-ice');
const toast = $('#toast');
const vuBar = $('#vu-bar');

let audioManager = new AudioManager();
let signaling = new SignalingClient();
let webrtc = null;
let ptt = null;
let diagnostics = null;

let state = {
  name: localStorage.getItem('walkie_name') || '',
  room: getRoomFromUrl() || localStorage.getItem('walkie_room') || '',
  deviceId: getDeviceId(),
  users: new Map(),
  you: null,
  muted: false,
};

// init UI
inputName.value = state.name;
inputRoom.value = state.room;
if (state.room) {
  shareLink.value = `${location.origin}/radio/${state.room}`;
  shareBox.classList.remove('hidden');
}

btnRandom.addEventListener('click', ()=>{
  inputRoom.value = generateRoomCode();
});

btnCreate.addEventListener('click', async ()=>{
  const code = (inputRoom.value.trim() || generateRoomCode()).toUpperCase();
  inputRoom.value = code;
  await enterRoom(code, true);
});
btnJoin.addEventListener('click', async ()=>{
  const code = inputRoom.value.trim().toUpperCase();
  if (!code) return showStartError('Ingresa un código de sala');
  await enterRoom(code, false);
});

btnCopy.addEventListener('click', async ()=>{
  try { await navigator.clipboard.writeText(shareLink.value); showToast('Enlace copiado'); } catch(e){ shareLink.select(); document.execCommand('copy'); }
});

function showStartError(msg){ startError.textContent = msg; startError.classList.remove('hidden'); setTimeout(()=>startError.classList.add('hidden'), 4000); }
function showToast(msg){ toast.textContent=msg; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.add('hidden'), 2500); }

async function enterRoom(roomCode, isCreate) {
  const name = inputName.value.trim();
  if (!name) return showStartError('Ingresa tu nombre');
  if (name.length<2) return showStartError('Nombre muy corto');
  if (!roomCode) return showStartError('Código de sala inválido');

  localStorage.setItem('walkie_name', name);
  localStorage.setItem('walkie_room', roomCode);
  state.name = name; state.room = roomCode;

  // Unlock audio first - iOS requirement
  await audioManager.unlockAudio();
  btnPtt.disabled = true;
  connText.textContent = 'OBTENIENDO MIC...';
  connDot.className='dot yellow';

  try {
    const stream = await audioManager.getMic();
    console.log('[app] mic ok', stream.id);
    diagMini.textContent = 'Micrófono OK • Conectando...';
  } catch(e){
    console.error(e);
    let msg='No se pudo acceder al micrófono.';
    if (e.name==='NotAllowedError') msg='Permiso de micrófono denegado. Actívalo en ajustes del navegador.';
    if (e.name==='NotFoundError') msg='No se encontró micrófono.';
    return showStartError(msg + ' ' + e.message);
  }

  // Conectar señalización
  signaling.connect();
  await new Promise((res, rej)=>{
    if (signaling.socket.connected) return res();
    signaling.socket.once('connect', res);
    signaling.socket.once('connect_error', rej);
    setTimeout(()=>rej(new Error('timeout señalización')), 8000);
  }).catch(err=>{
    showStartError('No se pudo conectar al servidor de señalización: ' + err.message);
    throw err;
  });

  // WebRTC
  webrtc = new WebRTCManager(signaling, audioManager, roomCode);
  webrtc.onConnectionState = (peerId, s)=> updateConnUI();
  webrtc.onUserSpeaking = (peerId, speaking)=>{
    // opcional VU remoto
  };
  await webrtc.init(audioManager.localStream);

  diagnostics = new Diagnostics({ audioManager, webrtcManager: webrtc, signaling });

  // PTT
  ptt = new PTTManager({
    btn: btnPtt,
    audioManager,
    signaling,
    getRoomCode: ()=> state.room,
    onStateChange: ({ state: st, message, speaker })=>{
      if (st==='talking') {
        channelState.textContent = message; channelState.className='chan talking';
        pttLabel.textContent='TRANSMITIENDO'; pttIcon.textContent='🔴';
        speakerName.classList.add('hidden');
      } else if (st==='blocked' || st==='busy') {
        channelState.textContent = message; channelState.className='chan busy';
        pttLabel.textContent='OCUPADO'; pttIcon.textContent='⏳';
        if (speaker) { speakerName.textContent = speaker.name; speakerName.classList.remove('hidden'); }
      } else if (st==='requesting') {
        channelState.textContent = message; channelState.className='chan busy';
        pttLabel.textContent='...'; pttIcon.textContent='📡';
      } else {
        channelState.textContent = message || 'CANAL LIBRE'; channelState.className='chan libre';
        pttLabel.textContent='PRESIONA PARA HABLAR'; pttIcon.textContent='🎙️';
        speakerName.classList.add('hidden');
      }
    }
  });

  // Listeners UI de sala
  signaling.on('joined-room', ({ roomCode, users, you })=>{
    state.you = you;
    state.users = new Map(users.map(u=>[u.id, u]));
    roomLabel.textContent = roomCode;
    updateUsersUI();
    updateConnUI();
    history.replaceState(null, '', `/radio/${roomCode}`);
    shareLink.value = `${location.origin}/radio/${roomCode}`;
    shareBox.classList.remove('hidden');
    showScreen('radio');
    btnPtt.disabled = false;
    connText.textContent='CONECTADO'; connDot.className='dot green';
    showToast(`Entraste a ${roomCode}`);
    // VU meter
    audioManager.startVuMeter((level)=>{
      vuBar.style.width = `${Math.min(100, level*300)}%`;
    });
  });

  signaling.on('user-joined', ({ user })=>{
    state.users.set(user.id, user);
    updateUsersUI(); showToast(`${user.name} entró`); updateConnUI();
  });
  signaling.on('user-left', ({ userId, user })=>{
    state.users.delete(userId);
    updateUsersUI(); if (user) showToast(`${user.name} salió`);
    updateConnUI();
  });
  signaling.on('users-update', ({ users })=>{
    state.users = new Map(users.map(u=>[u.id,u])); updateUsersUI();
  });

  signaling.on('channel-state', ({ speakerId, speaker })=>{
    if (speakerId && speaker) {
      if (speakerId !== signaling.socket.id) {
        channelState.textContent = `TRANSMITIENDO: ${speaker.name.toUpperCase()}`;
        channelState.className='chan busy';
        speakerName.textContent = speaker.name; speakerName.classList.remove('hidden');
      }
    }
  });

  signaling.on('error-msg', ({ message })=> showToast(message));

  signaling.on('disconnected', ({ reason })=>{
    connText.textContent='DESCONECTADO'; connDot.className='dot red';
    showToast(`Desconectado: ${reason}. Reintentando...`);
  });
  signaling.on('connected', ()=>{
    connText.textContent='CONECTADO'; connDot.className='dot green';
  });

  // Finalmente join
  signaling.joinRoom(roomCode, name, state.deviceId);

  // detectar tipo de conexión via stats polling
  setInterval(async ()=>{
    if (!webrtc) return;
    try {
      const pairs = await webrtc.getSelectedCandidatePairs();
      if (pairs.length) {
        const hasRelay = pairs.some(p=> p.remoteCandidateId && p.localCandidateId); // simplificado
        // Intentar obtener tipo real
        for (const peer of webrtc.peers.values()) {
          const stats = await peer.pc.getStats();
          stats.forEach(r=>{
            if (r.type==='local-candidate' && r.candidateType) {
              if (r.candidateType==='relay') { modeLabel.textContent='TURN'; iceLabel.textContent='RELAY'; }
              else if (r.candidateType==='srflx') { modeLabel.textContent='STUN'; iceLabel.textContent='SRFLX'; }
              else { modeLabel.textContent='DIRECTO'; iceLabel.textContent='HOST'; }
            }
          });
        }
      } else {
        modeLabel.textContent='CONECTANDO';
        iceLabel.textContent='...';
      }
    } catch(e){}
  }, 3000);
}

function updateUsersUI(){
  usersList.innerHTML='';
  const all = Array.from(state.users.values());
  usersCount.textContent = all.length;
  // incluirte a ti si quieres
  all.forEach(u=>{
    const row = document.createElement('div');
    row.className='user-row';
    if (ptt && ptt.currentSpeakerId===u.id) row.classList.add('speaking');
    row.innerHTML = `<span class="user-dot"></span><span class="user-name">${escapeHtml(u.name)}</span><span class="user-state">${u.id===state.you?.id?'TÚ':''}</span>`;
    usersList.appendChild(row);
  });
  // si hay speaker, marcarlo
  if (ptt && ptt.currentSpeakerId) {
    const el = Array.from(usersList.children).find((_,i)=> Array.from(state.users.keys())[i]===ptt.currentSpeakerId);
    if (el) el.classList.add('speaking');
  }
}

function updateConnUI(){
  const count = webrtc ? webrtc.peers.size : 0;
  iceLabel.textContent = count ? `${count} PEER${count>1?'S':''}` : 'SOLO';
}

function showScreen(which){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  if (which==='radio') screenRadio.classList.add('active');
  else screenStart.classList.add('active');
}

function escapeHtml(s){ return s.replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// Controles
vol.addEventListener('input', ()=> audioManager.setVolume(parseFloat(vol.value)));
btnMute.addEventListener('click', ()=>{
  state.muted = !state.muted;
  audioManager.setVolume(state.muted ? 0 : parseFloat(vol.value));
  btnMute.textContent = state.muted ? '🔊 Unmute' : '🔇 Mute';
});
btnLeave.addEventListener('click', ()=>{
  if (signaling.socket) signaling.leaveRoom(state.room);
  if (webrtc) webrtc.closeAll();
  audioManager.setTransmitting(false);
  showScreen('start');
  connText.textContent='DESCONECTADO'; connDot.className='dot yellow';
  history.replaceState(null,'','/');
});
btnDiag.addEventListener('click', async ()=>{
  modalDiag.classList.remove('hidden');
  diagBody.innerHTML='Ejecutando pruebas...';
  const res = await diagnostics.runAll();
  diagnostics.render(res, diagBody);
  // stats extra
  if (webrtc) {
    const stats = webrtc.getStats();
    stats.forEach(s=>{
      const div=document.createElement('div'); div.className='diag-line';
      div.innerHTML=`<span>Peer ${s.peerId.slice(0,6)} conn</span><span>${s.connectionState}/${s.iceConnectionState}</span>`;
      diagBody.appendChild(div);
    });
  }
});
btnCloseDiag.addEventListener('click', ()=> modalDiag.classList.add('hidden'));
btnTest.addEventListener('click', async ()=>{
  diagBody.innerHTML='Probando...';
  const res = await diagnostics.runAll();
  diagnostics.render(res, diagBody);
});
btnRestartIce.addEventListener('click', async ()=>{
  showToast('Reiniciando ICE...');
  if (webrtc) await webrtc.restartAllIce();
  modalDiag.classList.add('hidden');
});

// Auto-room from URL
window.addEventListener('DOMContentLoaded', async ()=>{
  if (state.room) {
    inputRoom.value = state.room;
    diagMini.textContent = `Sala detectada: ${state.room} • Ingresa tu nombre`;
  }
  // pre-check mic permission
  try {
    const perms = await navigator.permissions.query({ name:'microphone' });
    diagMini.textContent = `Mic: ${perms.state} • Listo`;
    perms.onchange = ()=> diagMini.textContent = `Mic: ${perms.state}`;
  } catch(e){
    diagMini.textContent = 'Listo para iniciar • HTTPS requerido para mic';
  }
});

// Evitar scroll accidental en PTT
document.addEventListener('touchmove', (e)=>{
  if (e.target.closest('#btn-ptt')) e.preventDefault();
}, { passive:false });